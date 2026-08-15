# @civ/pathfinding — réservé (phase 3)

Emplacement réservé pour la navigation :

- grille de navigation dérivée du terrain ;
- A\* ;
- `PathfindingService`, `PathRequestQueue`, `PathCache` ;
- budget de calculs par tick.

**Ce dossier ne contient volontairement aucun code** (voir « Pas de faux code » dans
[CLAUDE.md](../../CLAUDE.md)).

Point d'accroche déjà en place : `MovementSystem`
(`packages/simulation/src/systems/movementSystem.ts`) consomme une destination unique. Il
consommera une liste de points de passage sans que le système décideur change.
