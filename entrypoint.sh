#!/bin/sh
# Some PaaS platforms (e.g. Cloady) force environment variable keys to
# UPPERCASE. The xboard-node binary expects camelCase apiHost/apiKey/nodeID,
# so map the uppercase variants back before starting it.
[ -n "$APIHOST" ] && export apiHost="$APIHOST"
[ -n "$APIKEY" ] && export apiKey="$APIKEY"
[ -n "$NODEID" ] && export nodeID="$NODEID"

# HTTPS-ingress platforms (Cloady, ZevCloud, ...) terminate TLS at their
# gateway and forward PLAIN WebSocket to one fixed container port (3000),
# while the panel node is configured TLS-on (so subscriptions are correct)
# and the agent therefore listens with TLS on its service port (8443).
# Bridge the two: listen plain on the platform port and re-wrap each
# connection in TLS to the agent on loopback.
# Disable by setting SHIM_LISTEN=off. Ports overridable via
# SHIM_LISTEN_PORT / SHIM_TARGET_PORT.
if [ "$SHIM_LISTEN" != "off" ] && command -v socat >/dev/null 2>&1; then
  (
    while true; do
      socat "TCP-LISTEN:${SHIM_LISTEN_PORT:-3000},fork,reuseaddr" \
            "OPENSSL:127.0.0.1:${SHIM_TARGET_PORT:-8443},verify=0"
      sleep 1
    done
  ) &
fi

exec xboard-node "$@"
