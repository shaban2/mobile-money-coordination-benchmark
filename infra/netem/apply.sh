#!/bin/sh
set -eu

device="${NETEM_DEVICE:-eth0}"
delay="${NETEM_DELAY:-20ms}"
jitter="${NETEM_JITTER:-5ms}"
loss="${NETEM_LOSS:-0.1%}"

tc qdisc replace dev "$device" root netem delay "$delay" "$jitter" loss "$loss"
tc qdisc show dev "$device"
