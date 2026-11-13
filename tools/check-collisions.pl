#!/usr/bin/env perl
use strict;
use warnings;
use JSON::PP;
use File::Basename qw(dirname basename);
use File::Spec;

# ---------------------------------------------------------------------------
# check-collisions.pl
#
# Confirms that a candidate report number, lot/batch number, task number or PDF
# filename is not already taken by a record in coa-index.json.
#
# The registry is the authority: it is what the site searches. A PDF sitting in
# the S3 bucket with no record here is invisible to lookup, so uniqueness has to
# be enforced against this file, not against the bucket.
#
# Usage
#   perl tools/check-collisions.pl
#       Audit the registry itself for internal duplicates.
#
#   perl tools/check-collisions.pl VPL-261113-4821 LF-TS10-2612 TSK-55120
#       Check one or more candidate identifiers. The kind of each is detected
#       from its shape, so order does not matter.
#
#   perl tools/check-collisions.pl --docx-dir "C:/path/to/COA Templates"
#       Pull the identifiers out of every .docx in a folder and check them all.
#       Needs `unzip` on PATH.
#
# Options
#   --registry PATH   use a different coa-index.json
#   --quiet           print only collisions and the verdict
#
# Exit status is 0 when nothing collides and 1 when something does, so this can
# gate a commit or a release step.
# ---------------------------------------------------------------------------

my $registry;
my $docxdir;
my $quiet = 0;
my @candidates;

while (defined(my $arg = shift @ARGV)) {
    if    ($arg eq '--registry')  { $registry = shift @ARGV }
    elsif ($arg eq '--docx-dir')  { $docxdir  = shift @ARGV }
    elsif ($arg eq '--quiet')     { $quiet    = 1 }
    elsif ($arg =~ /^-h|^--help/) { usage(); exit 0 }
    elsif ($arg =~ /^-/)          { die "unknown option: $arg\n" }
    else                          { push @candidates, $arg }
}

sub usage {
    print <<'USAGE';
check-collisions.pl - confirm a COA identifier is not already in the registry

  perl tools/check-collisions.pl
  perl tools/check-collisions.pl VPL-261113-4821 LF-TS10-2612 TSK-55120
  perl tools/check-collisions.pl --docx-dir "C:/path/to/COA Templates"

  --registry PATH   use a different coa-index.json
  --quiet           print only collisions and the verdict
USAGE
}

# --- locate and load the registry ------------------------------------------

$registry //= File::Spec->catfile(dirname(dirname(File::Spec->rel2abs($0))), 'coa-index.json');
die "registry not found: $registry\n" unless -e $registry;

my $json = do {
    open my $fh, '<:raw', $registry or die "cannot read $registry: $!\n";
    local $/;
    <$fh>;
};
my $data  = decode_json($json);
my $rows  = ref $data eq 'ARRAY' ? $data : ($data->{records} // $data->{coas});
die "no records array in $registry\n" unless ref $rows eq 'ARRAY';

printf "registry : %s\n", $registry unless $quiet;
printf "records  : %d\n", scalar @$rows unless $quiet;

# --- index the registry, catching internal duplicates on the way -----------

my (%code, %lot, %task, %file);
my @internal;

for my $i (0 .. $#$rows) {
    my $r     = $rows->[$i];
    my $label = ($r->{compound} // '?') . ' / ' . ($r->{company} // '?');

    for my $spec ([ code => \%code, 'report number' ],
                  [ lot  => \%lot,  'lot number'    ],
                  [ accession => \%task, 'task number' ],
                  [ file => \%file, 'pdf filename'  ]) {
        my ($field, $bucket, $what) = @$spec;
        my $v = $r->{$field};
        next unless defined $v && $v =~ /\S/;
        my $k = uc $v;
        if (exists $bucket->{$k}) {
            push @internal, sprintf("%-13s %-22s used twice: %s AND %s", $what, $v, $bucket->{$k}, $label);
        } else {
            $bucket->{$k} = $label;
        }
    }
}

# --- gather candidates ------------------------------------------------------

my @checks;   # [ value, kind, origin ]

sub classify {
    my $v = shift;
    return 'pdf filename'  if $v =~ /\.pdf$/i;
    return 'report number' if $v =~ /^VPL-/i;
    return 'task number'   if $v =~ /^TSK-/i;
    return 'lot number'    if $v =~ /^[A-Z]{2,}-/i;
    return undef;
}

for my $v (@candidates) {
    my $kind = classify($v);
    unless ($kind) {
        warn "skipping '$v': cannot tell whether this is a report, lot, task or filename\n";
        next;
    }
    push @checks, [ $v, $kind, 'argument' ];
}

if (defined $docxdir) {
    die "no such folder: $docxdir\n" unless -d $docxdir;
    opendir my $dh, $docxdir or die "cannot open $docxdir: $!\n";
    my @docs = sort grep { /\.docx$/i && !/^~\$/ } readdir $dh;
    closedir $dh;
    die "no .docx files in $docxdir\n" unless @docs;
    printf "scanning : %d documents in %s\n", scalar @docs, $docxdir unless $quiet;

    for my $d (@docs) {
        my $path = File::Spec->catfile($docxdir, $d);
        my $xml  = `unzip -p "$path" word/document.xml 2>/dev/null`;
        unless (defined $xml && length $xml) {
            warn "could not read $d (is unzip on PATH?)\n";
            next;
        }
        my @t;
        while ($xml =~ m{<w:t[^>]*>([^<]*)</w:t>}g) { push @t, $1 }
        my %found;
        for my $run (@t) {
            $found{report} //= $run if $run =~ /^VPL-\S+-\d{4}$/;
            $found{task}   //= $run if $run =~ /^TSK-\S*\d{5}$/;
            $found{lot}    //= $run if $run =~ /^[A-Z]{2}-[A-Z0-9]+-\w+$/;
        }
        push @checks, [ $found{report}, 'report number', $d ] if $found{report};
        push @checks, [ $found{task},   'task number',   $d ] if $found{task};
        push @checks, [ $found{lot},    'lot number',    $d ] if $found{lot};
    }
}

# --- check candidates against the registry, and against each other ---------

my @hits;
my @dupes;
my %seen;

for my $c (@checks) {
    my ($v, $kind, $origin) = @$c;
    my $k = uc $v;

    my $bucket = $kind eq 'report number' ? \%code
               : $kind eq 'lot number'    ? \%lot
               : $kind eq 'task number'   ? \%task
               :                            \%file;

    if (exists $bucket->{$k}) {
        push @hits, sprintf("%-13s %-22s already used by %s", $kind, $v, $bucket->{$k});
    }
    if (exists $seen{"$kind\0$k"}) {
        push @dupes, sprintf("%-13s %-22s appears twice: %s AND %s", $kind, $v, $seen{"$kind\0$k"}, $origin);
    } else {
        $seen{"$kind\0$k"} = $origin;
    }
}

# --- report -----------------------------------------------------------------

print "\n" unless $quiet;

if (@internal) {
    print "DUPLICATES INSIDE THE REGISTRY\n";
    print "  $_\n" for @internal;
    print "\n";
} elsif (!$quiet) {
    print "registry internal duplicates : none\n";
}

if (@checks) {
    if (@dupes) {
        print "DUPLICATES AMONG THE CANDIDATES\n";
        print "  $_\n" for @dupes;
        print "\n";
    } elsif (!$quiet) {
        printf "candidates checked           : %d, no repeats among them\n", scalar @checks;
    }

    if (@hits) {
        print "COLLISIONS WITH THE REGISTRY\n";
        print "  $_\n" for @hits;
        print "\n";
    } elsif (!$quiet) {
        print "collisions with registry     : none\n";
    }
}

my $bad = @internal + @dupes + @hits;
print $bad == 0
    ? "OK - nothing collides\n"
    : "FAIL - $bad problem" . ($bad == 1 ? '' : 's') . " above\n";

exit($bad == 0 ? 0 : 1);
