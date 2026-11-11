# 6. CPU is the reference; GPU is an optional speed-up

Status: accepted (provisional, 2026-11-10)

## Decision
Every step has a CPU implementation that defines correct output. A WebGL/WebGPU path may be
added for speed and must match the CPU output in tests.

## Consequences
Golden tests run on CPU in Node. Reaction-diffusion waits for the GPU path to be usable live.
