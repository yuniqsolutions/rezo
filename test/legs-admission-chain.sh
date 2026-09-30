#!/bin/bash
# Admission v3.1 chain over R17, R18 and R19 — two passes:
#   pass A (calibrate): archive the previous canonical artifacts -> launcher controls -> dry-runs -> signal controls -> calibrations
#   pass B (canonical): canonical runs (after R19's exact RED sets are frozen from its calibration ledger)
# Usage: test/legs-admission-chain.sh calibrate | canonical
set -u
PASS=${1:-}
[ "$PASS" = calibrate ] || [ "$PASS" = canonical ] || [ "$PASS" = r19-calibrate ] || [ "$PASS" = r20 ] || [ "$PASS" = r21 ] || { echo "usage: $0 calibrate|canonical|r19-calibrate|r20|r21"; exit 9; }
ROOT="/Users/jmathew/Trae Project/Rezo"
cd "$ROOT" || exit 9
NODE=/opt/homebrew/Cellar/node/25.9.0_2/bin/node
RUN=/private/tmp/rezo-legs-v31/$(date -u +%Y%m%dT%H%M%SZ)-$PASS
mkdir -p "$RUN"
sha() { shasum -a 256 "$1" | awk '{print $1}'; }
BOOT_SRC="$(cat test/legs-bootstrap.mjs)"
BOOTSTRAP_SHA=$(printf '%s' "$BOOT_SRC" | shasum -a 256 | awk '{print $1}')
LAUNCHER_SHA=$(sha test/legs-launcher.mjs)
ADMISSION_SHA=$(sha test/legs-admission.mjs)
SELFTEST_SHA=$(sha test/legs-admission.test.mjs)
CLOSURES_SHA=$(sha test/legs-carrier-closures.json)
NODE_SHA=$(sha "$NODE")
ENV_SHA=$(sha /usr/bin/env)
R17=test/r17-curl-dns-ownership-legs.mjs; R18=test/r18-lifecycle-ownership-legs.mjs; R19=test/r19-stealth-fidelity-legs.mjs; R20=test/r20-fetch-connect-phase-legs.mjs; R21=test/r21-http-facade-legs.mjs
echo "RUN=$RUN PASS=$PASS"
echo "bootstrap(executed)=$BOOTSTRAP_SHA bootstrap(file)=$(sha test/legs-bootstrap.mjs)"
echo "launcher=$LAUNCHER_SHA admission=$ADMISSION_SHA selftest=$SELFTEST_SHA closures=$CLOSURES_SHA"
echo "r17=$(sha $R17) r18=$(sha $R18) r19=$(sha $R19) node=$NODE_SHA env=$ENV_SHA"

# Archive every artifact a stage would refuse to overwrite, tagged by the first 8 hex of its own sha (evidence dirs by their ledger's tag).
archive() { # path
  local src=$1; [ -e "$src" ] || return 0
  local tag; if [ -d "$src" ]; then tag=$2; else tag=$(sha "$src" | cut -c1-8); fi
  local dst
  case "$src" in
    *.json) dst="${src%.json}-epoch-${tag}.json";;
    *) dst="${src}-epoch-${tag}";;
  esac
  [ -e "$dst" ] && { echo "archive target exists: $dst"; exit 9; }
  mv "$src" "$dst"; echo "archived $src -> $dst"
}
if [ "$PASS" = calibrate ]; then
  for stem in r17-curl-dns-ownership-legs r18-lifecycle-ownership-legs r19-stealth-fidelity-legs; do
    ledger="plans/${stem}-ledger.json"; tag=""; [ -e "$ledger" ] && tag=$(sha "$ledger" | cut -c1-8)
    archive "$ledger"; [ -n "$tag" ] && archive "plans/${stem}-ledger-evidence" "$tag"
    archive "plans/${stem}-ledger.bootstrap-receipt.json"
    archive "plans/${stem}-signal-controls.json"; archive "plans/${stem}-signal-controls.bootstrap-receipt.json"
  done
  archive plans/legs-launcher-controls.json; archive plans/legs-launcher-controls.bootstrap-receipt.json
fi

run_stage() { # name mode driver ledger receipt expected_exit
  local name=$1 mode=$2 driver=$3 ledger=$4 receipt=$5 expected=$6
  local st="$RUN/$name"; mkdir -p "$st/home" "$st/tmp"
  echo "=== $name ($mode) start $(date -u +%H:%M:%SZ)"
  /usr/bin/env -i PATH=/opt/homebrew/bin:/opt/local/bin:/usr/bin:/bin HOME="$st/home" TMPDIR="$st/tmp" CURL_HOME="$st/home" XDG_CONFIG_HOME="$st/home" TZ=UTC LANG=C LC_ALL=C NO_COLOR=1 \
    REZO_LEGS_ROOT="$ROOT" REZO_LEGS_MODE="$mode" REZO_LEGS_DRIVER="$driver" REZO_LEGS_LAUNCHER=test/legs-launcher.mjs \
    REZO_LEGS_BOOTSTRAP_SHA256="$BOOTSTRAP_SHA" REZO_LEGS_LAUNCHER_SHA256="$LAUNCHER_SHA" REZO_LEGS_DRIVER_SHA256="$(sha "$driver")" \
    REZO_LEGS_ADMISSION_SHA256="$ADMISSION_SHA" REZO_LEGS_SELFTEST_SHA256="$SELFTEST_SHA" REZO_LEGS_CLOSURES_SHA256="$CLOSURES_SHA" \
    REZO_LEGS_NODE="$NODE" REZO_LEGS_NODE_SHA256="$NODE_SHA" REZO_LEGS_ENV_SHA256="$ENV_SHA" \
    REZO_LEGS_SCRATCH="$st/scratch" REZO_LEGS_LEDGER="$ledger" REZO_LEGS_RECEIPT="$receipt" \
    "$NODE" --input-type=module --eval "$BOOT_SRC" > "$st/stdout.log" 2> "$st/stderr.log"
  local code=$?
  echo "=== $name exit=$code (expected $expected) end $(date -u +%H:%M:%SZ) :: $(grep -E '^(ledger|bootstrap receipt) ' "$st/stdout.log" | tail -2 | cut -c1-220 | tr '\n' ' ')"
  if [ "$code" != "$expected" ]; then echo "CHAIN STOP at $name"; tail -5 "$st/stderr.log" | cut -c1-300; exit 1; fi
}

if [ "$PASS" = calibrate ]; then
  run_stage launcher-controls launcher-controls "$R17" "$ROOT/plans/legs-launcher-controls.json" "$ROOT/plans/legs-launcher-controls.bootstrap-receipt.json" 0
  run_stage r17-dry-run dry-run "$R17" "$RUN/r17-dry-run/scratch/ledger.json" "$RUN/r17-dry-run/receipt.json" 0
  run_stage r18-dry-run dry-run "$R18" "$RUN/r18-dry-run/scratch/ledger.json" "$RUN/r18-dry-run/receipt.json" 0
  run_stage r19-dry-run dry-run "$R19" "$RUN/r19-dry-run/scratch/ledger.json" "$RUN/r19-dry-run/receipt.json" 0
  run_stage r17-signal-controls signal-control "$R17" "$ROOT/plans/r17-curl-dns-ownership-legs-signal-controls.json" "$ROOT/plans/r17-curl-dns-ownership-legs-signal-controls.bootstrap-receipt.json" 0
  run_stage r18-signal-controls signal-control "$R18" "$ROOT/plans/r18-lifecycle-ownership-legs-signal-controls.json" "$ROOT/plans/r18-lifecycle-ownership-legs-signal-controls.bootstrap-receipt.json" 0
  run_stage r19-signal-controls signal-control "$R19" "$ROOT/plans/r19-stealth-fidelity-legs-signal-controls.json" "$ROOT/plans/r19-stealth-fidelity-legs-signal-controls.bootstrap-receipt.json" 0
  run_stage r17-calibration calibration "$R17" "$RUN/r17-calibration/scratch/ledger.json" "$RUN/r17-calibration/receipt.json" 0
  run_stage r18-calibration calibration "$R18" "$RUN/r18-calibration/scratch/ledger.json" "$RUN/r18-calibration/receipt.json" 0
  run_stage r19-calibration calibration "$R19" "$RUN/r19-calibration/scratch/ledger.json" "$RUN/r19-calibration/receipt.json" 0
elif [ "$PASS" = r20 ]; then
  # R20 (Fetch connect-phase legs) end to end: archive its own previous artifacts, dry-run, signal control, calibration, canonical.
  for f in plans/r20-fetch-connect-phase-legs-ledger.json plans/r20-fetch-connect-phase-legs-ledger.bootstrap-receipt.json plans/r20-fetch-connect-phase-legs-signal-controls.json plans/r20-fetch-connect-phase-legs-signal-controls.bootstrap-receipt.json; do archive "$f"; done
  [ -e plans/r20-fetch-connect-phase-legs-ledger-evidence ] && archive plans/r20-fetch-connect-phase-legs-ledger-evidence "$(date -u +%H%M%S)"
  run_stage r20-dry-run dry-run "$R20" "$RUN/r20-dry-run/scratch/ledger.json" "$RUN/r20-dry-run/receipt.json" 0
  run_stage r20-signal-controls signal-control "$R20" "$ROOT/plans/r20-fetch-connect-phase-legs-signal-controls.json" "$ROOT/plans/r20-fetch-connect-phase-legs-signal-controls.bootstrap-receipt.json" 0
  run_stage r20-calibration calibration "$R20" "$RUN/r20-calibration/scratch/ledger.json" "$RUN/r20-calibration/receipt.json" 0
  run_stage r20-canonical canonical "$R20" "$ROOT/plans/r20-fetch-connect-phase-legs-ledger.json" "$ROOT/plans/r20-fetch-connect-phase-legs-ledger.bootstrap-receipt.json" 0
elif [ "$PASS" = r21 ]; then
  # R21 (HTTP facade-contract legs) end to end: archive its own previous artifacts, dry-run, signal control, calibration, canonical.
  for f in plans/r21-http-facade-legs-ledger.json plans/r21-http-facade-legs-ledger.bootstrap-receipt.json plans/r21-http-facade-legs-signal-controls.json plans/r21-http-facade-legs-signal-controls.bootstrap-receipt.json; do archive "$f"; done
  [ -e plans/r21-http-facade-legs-ledger-evidence ] && archive plans/r21-http-facade-legs-ledger-evidence "$(date -u +%H%M%S)"
  run_stage r21-dry-run dry-run "$R21" "$RUN/r21-dry-run/scratch/ledger.json" "$RUN/r21-dry-run/receipt.json" 0
  run_stage r21-signal-controls signal-control "$R21" "$ROOT/plans/r21-http-facade-legs-signal-controls.json" "$ROOT/plans/r21-http-facade-legs-signal-controls.bootstrap-receipt.json" 0
  run_stage r21-calibration calibration "$R21" "$RUN/r21-calibration/scratch/ledger.json" "$RUN/r21-calibration/receipt.json" 0
  run_stage r21-canonical canonical "$R21" "$ROOT/plans/r21-http-facade-legs-ledger.json" "$ROOT/plans/r21-http-facade-legs-ledger.bootstrap-receipt.json" 0
elif [ "$PASS" = r19-calibrate ]; then
  # R19 only, no archive: re-calibrate after a carrier/fixture repair without re-running the other drivers.
  run_stage r19-dry-run dry-run "$R19" "$RUN/r19-dry-run/scratch/ledger.json" "$RUN/r19-dry-run/receipt.json" 0
  run_stage r19-calibration calibration "$R19" "$RUN/r19-calibration/scratch/ledger.json" "$RUN/r19-calibration/receipt.json" 0
else
  run_stage r17-canonical canonical "$R17" "$ROOT/plans/r17-curl-dns-ownership-legs-ledger.json" "$ROOT/plans/r17-curl-dns-ownership-legs-ledger.bootstrap-receipt.json" 0
  run_stage r18-canonical canonical "$R18" "$ROOT/plans/r18-lifecycle-ownership-legs-ledger.json" "$ROOT/plans/r18-lifecycle-ownership-legs-ledger.bootstrap-receipt.json" 0
  run_stage r19-canonical canonical "$R19" "$ROOT/plans/r19-stealth-fidelity-legs-ledger.json" "$ROOT/plans/r19-stealth-fidelity-legs-ledger.bootstrap-receipt.json" 0
fi
echo "CHAIN $PASS COMPLETE $(date -u +%H:%M:%SZ)"
