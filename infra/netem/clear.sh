#!/bin/sh
set -eu

device="${NETEM_DEVICE:-eth0}"
tc qdisc del dev "$device" root 2>/dev/null || true
tc qdisc show dev "$device"
