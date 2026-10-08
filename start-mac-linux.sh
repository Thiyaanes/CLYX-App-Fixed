#!/bin/bash
echo ""
echo "  CLYX — Your Digital Universe"
echo "  =============================="
echo ""

if ! command -v node &> /dev/null; then
  echo "  ERROR: Node.js not installed. Get it from https://nodejs.org"
  exit 1
fi

echo "  Starting CLYX Proxy (enables inline app loading)..."
node proxy.js &
PROXY_PID=$!

sleep 1

echo "  Opening CLYX..."
if [[ "$OSTYPE" == "darwin"* ]]; then
  open clyx.html
else
  xdg-open clyx.html 2>/dev/null || firefox clyx.html
fi

echo ""
echo "  ✓ CLYX Proxy running (PID $PROXY_PID)"
echo "  ✓ All apps open inline inside CLYX"
echo "  ✓ Press Ctrl+C to stop"
echo ""
wait $PROXY_PID
