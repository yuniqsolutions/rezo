#!/bin/sh
# Transparent real-cURL test route: no simulated outcome or ambient config.
# A final deadline also bounds a child whose parent test has been terminated.
unset SSLKEYLOGFILE CURL_SSL_BACKEND
exec curl --disable --noproxy '*' "$@" --connect-timeout 1 --max-time 2
