# 4. Machine profiles turn a Plot into machine output

(Applies to the Plotter output target; see ADR 0007.)

Status: accepted (provisional, 2026-11-10)

## Context
The plotter isn't bought yet. We want time estimates now and several protocols later
(SVG, G-code, HPGL, EBB for NextDraw/AxiDraw).

## Decision
A machine profile is JSON (`packages/machines/src/profiles/`): bed, origin, pen up/down and
change times, draw/travel speeds, acceleration, cornering factor, protocol. The `plot` step
uses it for the time estimate; drivers per protocol come later. The bundled `generic` profile
has placeholder numbers.

## Consequences
- A new plotter = a new profile plus, at most, a small driver.
- Time estimates are rough until a profile is calibrated against a real machine.
