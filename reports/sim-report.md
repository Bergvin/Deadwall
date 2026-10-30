# DeadWall: snjallari hermibotn ("Smart") og prófílar

**Dagsetning:** 30. október 2026
**Kóði:** `tools/bot.js` (`BOT_PROFILES`, `createBot`) og `tools/simulate.js`
**Fyrirmynd:** AI-prófílarnir í Astromage (`packages/engine/src/ai.ts`)

## Hvað var gert

| Áður | Núna |
|---|---|
| Einn fastur botn í `simulate.js` | **Prófílar** í `tools/bot.js`: `basic` (gamli botninn), `lazy`, ein turnategund (`arrow`, `fire`...), `smart`, `wide`, `tall`, `smart-noorders`, `smart-nospells` |
| Turnar í fastri röð | **Smart metur alla kosti:** hverja turnategund á hverjum lausum reit og hverja uppfærslu, eftir skaða sem hún bætir við á hvert gull |
| Sérhæfing eftir oddatölu | Smart **velur betri sérhæfinguna** |
| Sjaldgæfasta perkið | Smart **metur perk eftir áhrifum** |
| Sendi hlauparann aldrei | Smart **sendir hlauparann** að verðmætustu turnunum sem eru að tæmast |
| Ein keyrsla í einu | **Samhliða keyrsla** á öllum kjörnum (11 þræðir): 100 leikir á um 10 sekúndum |
| Bara bylgjufjöldi | `STATS=1`: skaði eftir turni og sérhæfingu, hvaða óvinir komast í húsið, perk í betri helmingi leikja. `OUT=` vistar öll gögn sem JSON |
| — | `SWEEP` prófar allar samsetningar af vægi, `SEED0` keyrir á öðrum fræjum, `tools/trace.js` rekur einn leik bylgju fyrir bylgju |

### Hvernig Smart metur kosti
- **Óvinir næstu 3 bylgna:** HP-vegið hlutfall brynju, resist, bossa og fjölda (`waves.preview`).
- **Virkur skaði turns:**
  - skaði á sekúndu × fjöldi skotmarka og svæði × hve mikið brynja eða resist étur;
  - þar ofan á bruni, napalm og blæðing;
  - mínus tími sem fer í að bíða eftir skotfærum.
- **Hve lengi óvinirnir eru í færi:** lengd vegar innan seilingar. Vegir sem opnast bráðum gilda 80%. Vegur sem er þegar vel varinn gildir minna, svo turnar dreifast á vegina.
- **Stuðningur** (hægja á, rota, ýta) telst sem hlutfall af skaða allra varnanna. Hann staflast ekki: annar Frost-turn gildir helmingi minna.
- **Uppfærsla:** aukinn virkur skaði mínus tíminn sem turninn er óvirkur á meðan hlauparinn smíðar.
- **Val:** botninn tekur kostinn með mest gildi á hvert gull. Hann sparar fyrir þeim besta nema eitthvað sem hann hefur efni á sé nánast jafngott (75%).
- **Húsið:** gert við það undir 70% HP.

### Lexía úr stillingunni (eins og í Astromage)
- **Fyrsta Smart-útgáfan var verri en gamli botninn** á þremur kortum af fimm. Hún ofmat svæðisskaða og byggði þrjá veika Frost-turna.
- **Hermunin er mjög breytileg.** Með 6 leikjum á hvert kort leit ein stilling út fyrir að vera 20% betri, en það var heppni. Stillt var með **20 leikjum á hvert kort (100 alls)** og niðurstaðan svo staðfest á **nýjum fræjum** (`SEED0=5000`).
- **Mestur ávinningurinn:**
  - meira vægi á að hægja á óvinum (`slowWeight` 0,9);
  - minna á svæðisskaða (`aoeWeight` 0,4);
  - að taka næstum jafngóðan kost strax í stað þess að spara.
- **The Hollow** (þrír vegir) var stóri veikleikinn: 8,3 á móti 14,3 hjá Basic með mið-commander. Það lagaðist þegar vegir sem eru lítið varðir og vegir sem opnast bráðum fengu meira vægi (14,4).

## Niðurstöður (staðfest á nýjum fræjum, `SEED0=5000`)

Meðaltal bylgju sem náðist. "+" þýðir að leikurinn náði 60 mínútna þakinu.

### Nýr commander (20 leikir á kort)

| Kort | Basic | **Smart** |
|---|---:|---:|
| The Old Road | 6,0 | **11,4** |
| Crossroads | 7,3 | **7,8** |
| River Bend | 7,6 | **8,2** |
| The Hollow | 4,5 | **5,3** |
| The Long March | 4,7 | **5,0** |
| **Öll kort** | **6,0** | **7,5** |

### Mið-commander (8 leikir á kort)

| Kort | Basic | **Smart** |
|---|---:|---:|
| The Old Road | 27,3 | **30,8** |
| Crossroads | 19,4 | **25,5** |
| River Bend | 20,8 | **25,5** |
| The Hollow | **13,0** | 12,8 |
| The Long March | 11,8 | **14,1** |

### Sterkur commander (8 leikir á kort, flestir ná 60 mínútna þakinu)

| Kort | Basic | **Smart** |
|---|---:|---:|
| The Old Road | 37,9+ | **42,8+** |
| Crossroads | **39,1+** | 38,8+ |
| River Bend | 38,6+ | **39,9+** |
| The Hollow | **36,0** | 34,6 |
| The Long March | 33,8+ | **39,6+** |

Smart er betri eða jafngóð alls staðar nema á The Hollow, þar sem munurinn er innan skekkjumarka.

### Hvað skiptir máli (Smart-afbrigði, nýr commander, The Old Road, mælt rétt fyrir síðustu breytinguna á dreifingu milli vega)

| Afbrigði | Bylgja |
|---|---:|
| Smart | 12,2 |
| Smart **án galdra** | 9,2 |
| Smart **án skipana** til hlauparans | 10,9 |
| Smart "tall" (meiri uppfærslur) | 11,8 |

**Galdrar hlauparans skipta mjög miklu máli** (+33%). Skipanir hjálpa líka (+12%).

## Hvað virkar (STATS, nýr commander, 100 leikir hvor, mælt rétt fyrir síðustu breytinguna á dreifingu milli vega)

| | Basic | Smart |
|---|---|---|
| Skaði eftir turni | Fire 31%, Boulder 21%, Frost 19%, Arrow 17% | **Fire 55%, Frost 26%**, Boulder 7%, Roller 5% |
| Sérhæfingar | (bara Volley valin) | **Inferno 59%**, Blizzard 27%, Quake 8% |
| Hvað kemst í húsið | Brute 42%, Walker 36%, Behemoth 18% | **Brute 53%**, Walker 24%, Behemoth 13% |

Perk sem eru algengari í betri helmingi leikja: Pocket Watch of Ages, Master Builder, Express Delivery, Golden Ammo og Stompy Boots. Twin Brother og Full Service skila minna en búast mætti við.

## Það sem hermunin bendir á fyrir jafnvægið

1. **Fire + Frost ráða ferðinni.** Smart velur Fire með Inferno og Frost með Blizzard aftur og aftur. Arrow er nánast aldrei valinn (2% af skaða), svo Arrow gæti þurft styrkingu, eða Fire smá veikingu.
2. **Brute er helsta ógnin**: yfir helmingur skaðans á húsinu. Það er eins og til er ætlast (brynja), en Boulder er lítið notaður gegn þeim.
3. **Bylgja 5 á The Long March er veggur.** Með nýjum commander deyja allir botnar þar (meðaltal 5,0, bæði Basic og Smart). Fyrsti boss (Behemoth) á lengsta veginum er of sterkur fyrir byrjanda. Kortið á reyndar að þurfa smá commander-framvindu.
4. **The Hollow er erfiðasta kortið** fyrir báða botna, líka með sterkum commander.

## Notkun

```
node tools/simulate.js 20 basic,smart 60 all            # samanburður á öllum kortum
STATS=1 node tools/simulate.js 20 smart 60 all           # hvað virkar
SWEEP='{"slowWeight":[0.5,0.9]}' node tools/simulate.js 20 smart 60 all   # stilla vægi
SEED0=5000 node tools/simulate.js 20 smart 60 all        # staðfesta á nýjum fræjum
COMMANDER=mid node tools/simulate.js 8 smart 60 all      # með commander-prófíl
node tools/trace.js hollow smart                         # einn leikur bylgju fyrir bylgju
```

## Næstu skref

- **Monte Carlo-botn ("Hard")**, eins og í Astromage: í hverjum undirbúningsfasa prófar hann nokkrar áætlanir (byggja, uppfæra, spara) með því að spila næstu bylgjur áfram, og velur þá bestu. Hermunin er ákveðin fyrir hvert fræ, svo það er hægt.
- Nota Smart til að stilla jafnvægi: Arrow, Fire og Long March-bossann.
