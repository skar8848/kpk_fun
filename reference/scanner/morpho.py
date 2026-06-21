"""Client Morpho GraphQL (stdlib only, zéro dépendance).

Toutes les requêtes tapent l'API publique gratuite api.morpho.org/graphql.
Schéma vérifié à la main (juin 2026) : les pièges connus sont commentés.
"""
from __future__ import annotations
import json
import time
import urllib.request
import urllib.error

ENDPOINT = "https://api.morpho.org/graphql"
ZERO = "0x0000000000000000000000000000000000000000"

CHAIN_IDS = {
    "ethereum": 1, "base": 8453, "arbitrum": 42161, "optimism": 10,
    "polygon": 137, "unichain": 130, "katana": 747474,
}


def gql(query: str, variables: dict | None = None, retries: int = 3) -> dict:
    """POST une requête GraphQL, renvoie data{} ou lève RuntimeError."""
    payload = json.dumps({"query": query, "variables": variables or {}}).encode()
    req = urllib.request.Request(
        ENDPOINT, data=payload, headers={"Content-Type": "application/json"}
    )
    last = None
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                body = json.loads(r.read())
            if body.get("errors"):
                raise RuntimeError(f"GraphQL errors: {body['errors'][:2]}")
            return body["data"]
        except urllib.error.HTTPError as e:
            last = e
            if e.code == 429:  # rate limit ~750/min
                time.sleep(1.5 * (attempt + 1))
                continue
            raise
        except (urllib.error.URLError, TimeoutError) as e:
            last = e
            time.sleep(1.0 * (attempt + 1))
    raise RuntimeError(f"GraphQL failed after {retries} tries: {last}")


# --- fragment oracle réutilisable ---
# Pièges: data est une union (OracleData) ; *OracleVault sont des objets {address};
# baseFeedX peut être null on-chain (= 0x0 => prix hardcodé à 1, cf. oracle_risk).
_ORACLE_FRAG = """
oracle {
  address
  type
  data {
    __typename
    ... on MorphoChainlinkOracleV2Data {
      baseFeedOne { address } baseFeedTwo { address }
      quoteFeedOne { address } quoteFeedTwo { address }
      baseOracleVault { address } quoteOracleVault { address }
    }
  }
}
"""

_MARKET_FRAG = f"""
marketId
lltv
collateralAsset {{ symbol address decimals }}
loanAsset {{ symbol address decimals }}
warnings {{ type level }}
state {{ supplyAssetsUsd borrowAssetsUsd collateralAssetsUsd utilization }}
{_ORACLE_FRAG}
"""


def get_vault_v1(address: str, chain: str) -> dict:
    """Vault MetaMorpho v1 -> allocations (marchés directs). Forme normalisée."""
    cid = CHAIN_IDS[chain]
    q = f"""
    query($a: String!, $c: Int!) {{
      vaultByAddress(address: $a, chainId: $c) {{
        name
        asset {{ symbol address decimals }}
        state {{
          totalAssetsUsd
          allocation {{
            supplyAssetsUsd
            market {{ {_MARKET_FRAG} }}
          }}
        }}
      }}
    }}"""
    v = gql(q, {"a": address, "c": cid})["vaultByAddress"]
    if not v:
        raise RuntimeError(f"vault v1 {address} introuvable sur {chain}")
    st = v["state"] or {}
    allocs = []
    for a in (st.get("allocation") or []):
        usd = float(a.get("supplyAssetsUsd") or 0)
        if usd <= 0 or not a.get("market"):
            continue
        allocs.append({"supplyUsd": usd, "market": a["market"]})
    allocs.sort(key=lambda x: -x["supplyUsd"])
    return {
        "address": address, "chain": chain, "name": v.get("name"),
        "version": "v1", "asset": v.get("asset"),
        "tvlUsd": float(st.get("totalAssetsUsd") or 0),
        "allocations": allocs,
    }


def get_market(market_id: str, chain: str) -> dict:
    cid = CHAIN_IDS[chain]
    q = f"query($id: String!, $c: Int!){{ marketById(id:$id, chainId:$c){{ {_MARKET_FRAG} }} }}"
    return gql(q, {"id": market_id, "c": cid})["marketById"]


def markets_by_collateral(collateral_addr: str, chain: str, limit: int = 50) -> list[dict]:
    """Tous les marchés où ce token est collatéral (pour le rayon de contagion)."""
    cid = CHAIN_IDS[chain]
    q = f"""
    query($col: String!, $c: Int!, $n: Int!) {{
      markets(first: $n, where: {{ collateralAssetAddress_in: [$col], chainId_in: [$c] }}) {{
        items {{ {_MARKET_FRAG} }}
      }}
    }}"""
    return gql(q, {"col": collateral_addr, "c": cid, "n": limit})["markets"]["items"]
