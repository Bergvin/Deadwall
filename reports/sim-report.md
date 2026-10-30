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

---

# Uppfærsluaðferðir (The Old Road, nýr commander, 30 leikir hver)

Ný prófílar í `tools/bot.js`. Þeir velja turnategundir og reiti eins og Smart, en fylla öll turnapláss fyrst og fylgja svo fastri uppfærslureglu:

| Aðferð | Prófíll | Meðaltal | Miðgildi | Bil |
|---|---|---:|---:|---|
| Smart (mest skaði á gull) | `smart` | **12,0** | 11 | 5–19 |
| Smart, hallast að nýjum turnum | `wide` | **12,0** | 10 | 5–20 |
| Smart, hallast að uppfærslum | `tall` | 11,5 | 11 | 5–16 |
| Einn turn í hámark fyrst | `focus` | 11,0 | 10 | 6–20 |
| Uppfæra turninn sem gerir mestan skaða | `topdps` | 11,0 | 10 | 6–20 |
| Ódýrasta uppfærslan fyrst | `cheapest` | 8,9 | 9 | 6–11 |
| Allir turnar jafnt | `even` | 8,7 | 9 | 6–10 |
| Frost + Gale fyrst | `slowfirst` | 5,9 | 5,5 | 5–10 |
| Gamli botninn (föst röð, ódýrast fyrst) | `basic` | 5,8 | 6 | 5–9 |

**Hvað þetta segir:**
- **Að einbeita sér borgar sig.** Smart og „einn í hámark“ ná báðar um 11–12 bylgjum. Að dreifa uppfærslum jafnt eða taka alltaf ódýrustu skilar bara um 9: turnarnir ná aldrei stigi 5 (sérhæfingu), og stóru stökkin koma ekki.
- **„Einn í hámark“ og „mestan skaða fyrst“ urðu eins** (sama tala, sömu leikir), því sterkasti turninn er alltaf sá sem er hæst uppfærður.
- **„Einn í hámark“ er mjög sveiflukennd:** 6 til 20. Hún vinnur stórt þegar fyrsti turninn er réttur, en tapar snemma annars. Smart er stöðugri.
- **Að byrja á Frost og Gale er slæmt** (5,9). Hægingin hjálpar ekki fyrr en eitthvað drepur.
- **Sigurturninn fer eftir aðferðinni:**
  - Smart velur Fire Inferno (61% skaðans) með Frost Blizzard (29%).
  - Einn í hámark endar oft með Frost Blizzard (57%) og Boulder Quake (39%).
  - Fleiri en ein leið virkar, sem er gott.
- **Arrow er nánast aldrei með** (1–2% hjá öllum nema gamla botninum) og **Brute veldur mestum skaðanum** á húsinu hjá öllum góðu aðferðunum. Þetta styður niðurstöðuna hér að ofan.

Keyrt með: `STATS=1 node tools/simulate.js 30 basic,smart,wide,tall,cheapest,focus,even,topdps,slowfirst 60 oldroad`

---

# Turnar, sérhæfingar og perk hlauparans

**Dagsetning:** 30. október 2026. Smart-botninn, nýr commander.

## Turnar (Smart, öll kort, 100 leikir)

| Turn | Á leik | Meðalstig | Skaði á leik | Skaði á 100 gull | Dráp á leik | Án skotfæra | Í smíði |
|---|---:|---:|---:|---:|---:|---:|---:|
| **Fire** | 0,99 | 3,6 | 199.369 | **30.648** | 157,5 | 0% | 2% |
| Frost | 1,52 | 2,8 | 85.398 | 14.913 | 71,0 | 0% | 1% |
| Rolling Stone | 1,00 | 1,9 | 25.359 | 8.193 | 62,3 | 0% | 0% |
| Boulder | 0,21 | 2,4 | 4.115 | 4.367 | 4,3 | 1% | 1% |
| Arrow | 0,88 | 2,5 | 7.244 | 2.742 | 15,5 | 0% | 1% |
| Gale | 0,77 | 3,2 | 12.883 | 2.641 | 13,8 | 1% | 2% |

**Skaði á 100 gull** segir hvað fæst fyrir gullið. Turnar sem lifa fram í seinni bylgjur fá hærri tölu, því HP óvina vex hratt.

| Sérhæfing | Á leik | Meðalstig | Skaði á 100 gull | Dráp á leik |
|---|---:|---:|---:|---:|
| **Fire: Inferno** | 0,28 | 5,9 | **48.324** | 112,5 |
| Frost: Blizzard | 0,28 | 5,4 | 28.215 | 42,5 |
| Rolling Stone: Spiked Ball | 0,05 | 5,0 | 11.122 | 1,2 |
| Gale: Tailwind | 0,15 | 7,2 | 3.503 | 8,7 |
| Arrow: Volley | 0,15 | 5,8 | 2.888 | 1,3 |
| Boulder: Quake | 0,04 | 5,0 | 1.567 | 0,2 |

Hinar sérhæfingarnar (Napalm, Deep Freeze, Sniper, Armor Breaker, Hurricane, Twin Stones) voru aldrei valdar.

## Ein turnategund í einu (Smart, The Old Road, 30 leikir hver)

| Bara | Bylgja |
|---|---:|
| Rolling Stone | **7,0** |
| Fire | 6,5 |
| Frost | 5,5 |
| Boulder | 5,5 |
| Arrow | 5,0 |
| Gale | 3,4 |
| (Smart með alla turna) | 12,0 |

Blandan skiptir öllu máli: engin ein tegund kemst nálægt 12. **Rolling Stone er sterkastur einn og sér**, en Smart notar hann lítið í blöndu.

## Perk hlauparans: tilraun (Smart, The Old Road, 30 leikir á perk)

Hvert perk var gefið strax í byrjun og borið saman við leiki án perks (grunnlína **11,97**). Það mælir raunveruleg áhrif. Talningin „algengt í góðum leikjum“ ruglast af því að langir leikir fá fleiri perk.

Óvissan á hverja tölu er um ±0,9 bylgjur. Bara efstu perkin eru því marktæk.

| Perk | Sjaldgæfni | Bylgja | Munur |
|---|---|---:|---:|
| **Pocket Watch of Ages** | mythical | 15,10 | **+3,13** |
| **Golden Ammo** | epic | 14,03 | **+2,07** |
| **Oiled Gears** | uncommon | 13,90 | **+1,93** |
| Full Service | uncommon | 13,13 | +1,17 |
| Stilts (galdur) | uncommon | 13,07 | +1,10 |
| Perpetual Motion | mythical | 13,03 | +1,07 |
| Crate on a Stick | epic | 12,90 | +0,93 |
| Handyman | common | 12,83 | +0,87 |
| Pocket Almanac | rare | 12,80 | +0,83 |
| Strong Coffee, Nimble Fingers, Saucepan Helmet, Stompy Boots | | 12,5 | +0,5 |
| Bottomless Pockets, Overclock, Recycler, Express Delivery, Tea Break, Cheerleader, Tinkerer | | 12,3–12,4 | +0,4 |
| Twin Brother, Loud Whistle, Master Builder, Bigger Backpack | | 12,0 | ±0 |
| Pep Talk (rank 2), Lucky Socks, Prefab Parts, Squeaky Sneakers, Banana Peel | | 11,4–11,9 | −0,1 til −0,5 |

## Hlauparinn (Smart, öll kort, 100 leikir)

- **Á leik:**
  - stig 10,5;
  - 81 áfylling;
  - 9,6 uppfærslur smíðaðar;
  - 9,7 sinnum felldur;
  - 4,3 kassar týndir.
- **Galdrar á leik:** Pep Talk 30, Lucky Socks 14, Stilts 10, Overclock 10, Bottomless 6, Banana Peel 4, Tea Break 4.

## Það sem þetta segir um jafnvægið

1. **Skotfærin skipta nánast engu máli.** Turnar eru tómir 0–1% af tímanum. Hlauparinn nær alltaf að fylla á, svo kjarninn í hlutverki hans er ekki undir pressu. Það mætti minnka magasín, hægja á honum eða láta hann bera færri kassa.
2. **Fire er langbesti turninn.** Hann gerir tvöfaldan skaða á gull á við Frost og tífaldan á við Arrow og Gale. Inferno er sterkasta sérhæfingin. Fire þarf veikingu eða hinir styrkingu.
3. **Arrow, Gale og Boulder eru veikir:** um 2.600–4.400 skaði á 100 gull.
4. **Helmingur sérhæfinganna er aldrei valinn**, því Smart metur þær verri. Napalm, Sniper, Armor Breaker o.fl. þurfa endurskoðun.
5. **Perk sem gera turnana sterkari vinna:** Golden Ammo, Oiled Gears og Pocket Watch.
6. **Perk um hlauparann sjálfan skila nánast engu:** hraði, kassar, Twin Brother og Master Builder. Þetta passar við lið 1: hann er ekki flöskuhálsinn.
7. **Twin Brother og Master Builder eru legendary en gera ekkert mælanlegt.** Þau þurfa styrkingu, eða leikurinn þarf að gera hlauparann mikilvægari.

Keyrt með:
```
STATS=1 node tools/simulate.js 20 smart 60 all
GRANTS=all node tools/simulate.js 30 smart 60 oldroad
SWEEP='{"allowTypes":[["arrow"],["fire"],["frost"],["boulder"],["gale"],["roller"]]}' node tools/simulate.js 30 smart 60 oldroad
```
