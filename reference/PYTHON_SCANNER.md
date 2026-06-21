# KPK Contagion Scanner

Outil de risk on-chain : décompose l'**exposition transitive** d'un vault Morpho
jusqu'aux primitives de risque, détecte les structures de loop/carry, et analyse
la **fiabilité des oracles** (la leçon du hack Resolv USR, mars 2026).

> Un collatéral n'est pas une feuille. `sUSDe` → `USDe` (delta-neutral Ethena,
> funding + custody CEX) → `USDT`. Le scanner déplie cette chaîne et agrège :
> *"X % de ce vault USDC est transitivement exposé à Ethena / au funding des perps"*
> — alors qu'il n'y a aucune position Ethena directe.

## Usage

```bash
python3 -m scanner <vault_address> [chain]
# ex (Smokehouse USDC, ethereum) :
python3 -m scanner 0xBEeFFF209270748ddd194831b3fa287a5386f5bC ethereum
```

Zéro dépendance (stdlib only). Python 3.11+.

## Ce qu'il sort

- **Exposition transitive** : récursion dépliée → primitives de risque, en $ et %.
- **Exposition par protocole** : tous niveaux de la chaîne (Pendle, Ethena, Lido…).
- **Loops / carry** : marchés où le collatéral partage l'underlying du loan ; leverage borné par LLTV.
- **Contagion oracle** : "si telle hypothèse casse → $ exposés sur N marchés".
- **Arbre par position** + sévérité 🟢🟡🔴.
- **Collatéraux non mappés** : explicitement listés (jamais de faux négatif silencieux).

## Architecture

| Module | Rôle |
|---|---|
| `morpho.py` | Client GraphQL Morpho (gratuit, sans clé). Vaults v1, marchés, `oracle.data`, `warnings`. |
| `knowledge.py` | Carte curée des dépendances yield-bearing (le cerveau de la récursion). Extensible. |
| `oracle_risk.py` | Détection peg hardcodé / NAV issuer-controlled / oracle opaque + warnings Morpho → buckets de contagion. |
| `decompose.py` | Moteur : récursion d'exposition, agrégation transitive, loops, leverage implicite. |
| `cli.py` | Rendu terminal du rapport. |

### Détection oracle (la leçon Resolv)

- **peg_assumption** : hardcode d'un stable majeur (USDC=$1) → standard, informationnel.
- **hardcoded_peg** : hardcode d'un collatéral *exotique* → 🟡 (c'était le péché Resolv).
- **nav_dependency** : prix via NAV ERC-4626 contrôlée par l'émetteur → 🟡.
- **opaque_oracle** : oracle inconnu/custom → 🔴.
- **PRICE_DERIVATION_DIVERGENCE / BAD_DEBT** : warnings RED émis par Morpho.

## Roadmap

- [ ] **v2 vaults** (adapters → underlying) en plus des v1.
- [ ] Enrichir les feuilles : santé stablecoin via **DefiLlama** (peg/history, gratuit) + **Pharos Watch** (PegScore/DEWS, clé gratuite).
- [ ] Pondération réelle des underlyings (au lieu de parts égales) via reserves on-chain.
- [ ] Rayon de contagion inter-vaults (`markets_by_collateral` déjà en place).
- [ ] Couche labels/contrats via **Herd.eco** ; fund-tracing case study via Etherscan V2.
- [ ] Export graphe (cytoscape/graphviz).

## Limites assumées

- `knowledge.py` est curé à la main → tout token non mappé est **flaggé** (pas
  deviné). C'est le point faible explicite, par design.
- Répartition entre underlyings = parts égales (faute de poids on-chain en v1).
- Données = état **courant** Morpho (pas d'historique ; voir le case study Resolv séparé).
