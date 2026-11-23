#!/bin/sh
# Some PaaS platforms (e.g. Cloady) force environment variable keys to
# UPPERCASE. The xboard-node binary expects camelCase apiHost/apiKey/nodeID,
# so map the uppercase variants back before starting it.
[ -n "$APIHOST" ] && export apiHost="$APIHOST"
[ -n "$APIKEY" ] && export apiKey="$APIKEY"
[ -n "$NODEID" ] && export nodeID="$NODEID"
exec xboard-node "$@"
