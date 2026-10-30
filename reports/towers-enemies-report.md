# DeadWall: nýju turnarnir og óvinirnir (Bloons TD-stíll)

**Dagsetning:** 30. október 2026
**Hvað var prófað:** 11 turnar (5 nýir) og 4 nýir óvinir með eiginleikum. Prófað var með:
- matchup-tilraunastofu: hver turn á móti hverjum óvini;
- 15 mismunandi aðferðum á öllum 5 kortunum;
- nýjum, mið- og sterkum commander;
- perk-tilraun.

Alls um 3.500 leikir.

**Tól:** `tools/matchup.js` (nýtt), `tools/simulate.js`, `tools/bot.js`

## Hvað er nýtt í leiknum

| Turn | Hlutverk | Sérhæfingar |
|---|---|---|
| **Watchtower** ◉ | Afhjúpar stealth í færi fyrir alla turna; lítill eigin skaði | Beacon (+2,5 færi) / Hunter's Mark (+25% skaði á óvini í ljósinu) |
| **Arcane** ✦ | Magic-skaði: fer í gegnum brynju, drauga og járn | Arcane Missiles (3 skotmörk) / Seer (sér stealth) |
| **Alchemist** ⚗ | Eitur sem skvettist og hunsar brynju og resist, stöðvar endurnýjun | Corrosive (rífur brynju) / Plague Cask (stærra, sterkara eitur) |
| **Tesla Coil** ϟ | Elding sem hoppar á milli óvina | Storm Coil (+3 hopp) / Overload (+80% skaði, rot) |
| **Ballista** ➹ | Þú miðar henni; boltinn fer í gegnum allt á línunni | Repeater (2× hraðar) / Siege Bolt (2× skaði, ýtir aftur) |

| Óvinur | Eiginleiki | Hvað vinnur á honum |
|---|---|---|
| **Wraith** (frá bylgju 10) | Stealth: aðeins turnar sem sjá hann geta miðað á hann | Watchtower nálægt, Arrow Sniper, Arcane Seer; svæðisskaði hittir hann líka |
| **Ghost** (frá 8) | Ónæmur fyrir physical | Fire, Frost, Arcane, Alchemist, Tesla |
| **Ironclad** (frá 7) | Ónæmur fyrir sharp (Arrow, Gale) | Allt annað |
| **Rotter** (frá 12) | Endurnýjar HP ef hann er látinn í friði | Eitur (Alchemist) stöðvar það; mikill skaði í einu |

Skaðatölur yfir óvinum eru horfnar. **Damage meter** vinstra megin raðar turnum eftir skaða (í þessari bylgju eða alls), og smellur velur turninn.

## 1. Matchup: hver turn á móti hverjum óvini

Einn turn er settur við beinan kafla á The Old Road. Röð 12 óvina af einni tegund gengur framhjá honum, með ókeypis skotfærum. Taflan sýnir **hve stórum hluta af HP raðarinnar turninn eyddi**. 0% þýðir að turninn getur ekki snert þá.

### Stig 1 (óvinir með venjulegt HP)

| Turn | Walker | Runner | Brute | Plague | Smasher | **Wraith** | **Ghost** | **Ironclad** | **Rotter** |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Arrow | 65% | 77% | 6% | 32% | 7% | 0% | 0% | 0% | 27% |
| Fire | 96% | 90% | 36% | 30% | 19% | 0% | 78% | 54% | 52% |
| Frost | 88% | 54% | 43% | 33% | 16% | 0% | 71% | 63% | 54% |
| Boulder | 87% | 75% | 23% | 43% | 18% | 0% | 0% | 30% | 45% |
| Gale | 57% | 56% | 23% | 46% | 38% | 0% | 0% | 0% | 116%* |
| Rolling Stone | 100% | 75% | 100% | 100% | 100% | 0% | 0% | 100% | 263%* |
| Watchtower | 23% | 27% | 5% | 5% | 3% | **13%** | 14% | 8% | 9% |
| Arcane | 57% | 79% | 13% | 13% | 9% | 0% | 37% | 21% | 23% |
| Alchemist | 88% | 92% | 28% | 45% | 13% | 0% | 67% | 37% | 43% |
| Tesla Coil | 90% | 70% | 21% | 22% | 13% | 0% | 63% | 36% | 41% |
| Ballista | 100% | 100% | 81% | 100% | 100% | 0% | 0% | 100% | 115%* |

\* Meira en 100%: Rotter endurnýjar sig, og turnar sem ýta til baka (Gale, Rolling Stone og Ballista Siege Bolt) halda óvinunum lengi í færi. **Turnar sem ýta fá því of háar tölur í þessari tilraun.** Í alvöru leik verða óvinir „enraged“ eftir 45 sekúndur og hætta að ýtast.

### Stig 8 með sérhæfingu (óvinir með 25× HP)

| Turn | Walker | Runner | Brute | Wraith | Ghost | Ironclad | Rotter |
|---|---:|---:|---:|---:|---:|---:|---:|
| Arrow: Volley | 68% | 78% | 7% | 0% | 0% | 0% | 28% |
| Arrow: Sniper | 51% | 52% | 6% | **37%** | 0% | 0% | 22% |
| Fire: Napalm | 100% | 97% | 45% | 0% | 83% | 68% | 60% |
| Fire: Inferno | 97% | 88% | 39% | 0% | 80% | 58% | 58% |
| Frost: Blizzard | 100% | 81% | 48% | 0% | **97%** | 78% | 75% |
| Boulder: Quake | 99% | 65% | **73%** | 0% | 0% | 87% | 109% |
| Boulder: Armor Breaker | 42% | 55% | 15% | 0% | 0% | 21% | 21% |
| Gale: Tailwind | 91% | 100% | 5% | 0% | 0% | 0% | 33% |
| Rolling Stone: Twin Stones | 100% | 100% | 99% | 0% | 0% | 100% | 707%* |
| Arcane: Arcane Missiles | 55% | 68% | 12% | 0% | 36% | 21% | 22% |
| Arcane: Seer | 31% | 35% | 7% | 18% | 20% | 12% | 13% |
| Alchemist: Plague Cask | 97% | 98% | 38% | 0% | 75% | 54% | 58% |
| Tesla: Storm Coil | 46% | 23% | 10% | 0% | 29% | 16% | 18% |
| Tesla: Overload | 63% | 52% | 14% | 0% | 41% | 23% | 26% |
| Ballista: Repeater | 100% | 100% | 49% | 0% | 0% | 98% | 100% |
| Ballista: Siege Bolt | 100% | 100% | **100%** | 0% | 0% | 100% | 109% |

**Það sem tafla 1 sýnir:**
- **Eiginleikarnir virka eins og í BTD6.** Ghost og Ironclad gera physical- og sharp-turna gagnslausa. Wraith sést aðeins af Sniper, Seer og Watchtower.
- **Sterkust á móti öllu:** Fire, Frost Blizzard, Boulder Quake, Rolling Stone og Ballista (á beinum vegi).
- **Arcane og Tesla eru of veikir.** Þeir eru 20–40% á eftir Fire á flestum óvinum, og Tesla Storm Coil er veikari en grunnturninn.
- **Seer og Armor Breaker eru verri en hin sérhæfingin.** Seer fórnar of miklum skaða fyrir að sjá stealth.
- **Watchtower drepur nánast ekkert sjálfur,** eins og til er ætlast: hann er stuðningsturn.

## 2. Aðferðir (nýr commander, 20 leikir á kort, öll kort)

Meðaltal bylgju:

| Aðferð | Old Road | Crossroads | River Bend | Hollow | Long March | **Öll** |
|---|---:|---:|---:|---:|---:|---:|
| **Bara gömlu 6 turnarnir** (Smart) | **9,6** | **8,1** | **8,2** | 5,5 | 5,0 | **7,28** |
| Smart (allir turnar) | 8,3 | 6,2 | 7,8 | 4,5 | 5,2 | 6,40 |
| Smart „wide“ | 8,3 | 6,2 | 7,8 | 4,5 | 5,2 | 6,40 |
| Basic (gamli botninn) | 6,1 | 7,2 | 7,8 | **5,6** | 4,8 | 6,30 |
| Smart án skipana | 7,8 | 6,1 | 7,9 | 4,5 | 5,2 | 6,30 |
| Horfir 6 bylgjur fram | 7,8 | 6,2 | 7,8 | 4,3 | **5,3** | 6,28 |
| Smart „tall“ | 7,9 | 6,0 | 7,7 | 4,6 | 5,0 | 6,24 |
| Smart án galdra | 7,3 | 6,0 | 7,7 | 4,9 | 5,0 | 6,18 |
| Einn turn í hámark | 7,7 | 6,3 | 8,0 | 4,5 | 4,3 | 6,16 |
| Ódýrast fyrst | 7,7 | 6,0 | 8,1 | 4,5 | 4,3 | 6,12 |
| Allir jafnt | 7,7 | 6,0 | 8,1 | 4,5 | 4,3 | 6,12 |
| Watchtower snemma | 7,6 | 5,4 | 7,3 | 4,5 | 5,0 | 5,96 |
| Frost + Gale fyrst | 6,7 | 6,9 | 7,4 | 4,4 | 4,3 | 5,94 |
| **Bara nýju 5 turnarnir** | 7,5 | 5,7 | 5,5 | **3,0** | 4,5 | **5,24** |

### Með commander-framvindu (8 leikir á kort)

| Aðferð | Mið-commander | Sterkur commander |
|---|---:|---:|
| Bara gömlu turnarnir | **16,6** | **34,6** |
| Ódýrast fyrst | 15,9 | 31,0 |
| Basic | 15,0 | **34,6** |
| Smart (allir turnar) | 14,6 | 30,8 |
| Einn í hámark | 14,6 | 31,2 |
| Bara nýju turnarnir | 12,0 | 28,8 |

**Það sem tafla 2 sýnir:**
1. **Nýju turnarnir gera botnana verri.** Með gömlu turnunum eingöngu nær Smart 7,3; með öllum 11 aðeins 6,4. Bara nýju turnarnir skila 5,2.
   - Smart ofmat **Ballista**: hann byggði 2,6 á leik, en þær gáfu helmingi minni skaða á gull en Fire. Matið var lækkað (`lineHits` 2,5 → 0,8), en það lokaði ekki bilinu.
   - Smart byggir **aldrei Arcane eða Tesla**, og matchup-taflan sýnir að það er rétt mat: þeir eru veikari en Fire og Frost á nánast öllu.
2. **Leikurinn er orðinn erfiðari** vegna nýju óvinanna. Mið-commander á The Old Road fór úr um 31 í 24 með bestu aðferð. Sterkur commander var áður 35–43 og er nú 29–35.
3. **Engin ein uppfærsluaðferð vinnur stórt** með nýjum commander (6,1–6,4). „Ódýrast fyrst“ stendur sig best með mið-commander.
4. **Watchtower snemma borgar sig ekki** (5,96). Wraiths koma ekki fyrr en í bylgju 10, og flestir leikir með nýjum commander enda fyrr.
5. **The Hollow og The Long March eru enn veggir.** Allar aðferðir deyja í bylgju 4–6 með nýjum commander.

## 3. Turnar í leik (Smart, öll kort, 100 leikir)

| Turn | Á leik | Skaði á 100 gull | Dráp á leik |
|---|---:|---:|---:|
| Fire (bara gamlir turnar) | 1,04 | **13.330** | 119 |
| Ballista | 2,59 | 7.327 | 105 |
| Rolling Stone | 1,00 | 6.973 | 64 |
| Frost | 1,50 | 6.533 | 56 |
| Boulder | 0,19 | 3.736 | 3 |
| Arrow | 0,84 | 2.678 | 16 |
| Alchemist (bara nýir turnar) | 1,06 | 1.894 | 24 |
| Gale | 0,75 | 1.296 | 11 |
| Watchtower | 0,01 | 506 | 0 |

Bestu sérhæfingarnar í leik: **Fire Inferno** (22.070 á 100 gull), **Ballista Siege Bolt** (21.222), Frost Blizzard (15.051) og Rolling Stone Spiked Ball (14.149).

## 4. Perk hlauparans (gefið í byrjun, Smart með gömlu turnunum, 20 leikir á perk, grunnlína 7,20)

| Perk | Munur |
|---|---:|
| **Pocket Watch of Ages** (mythical) | **+2,30** |
| **Golden Ammo** (epic) | **+2,25** |
| Pocket Almanac (rare) | +1,65 |
| Duct-Tape Overclock (rare) | +1,45 |
| Ammo Recycler, Stilts, Squeaky Sneakers, Oiled Gears, Pep Talk, Strong Coffee, Perpetual Motion | +1,0 til +1,25 |
| … Twin Brother, Express Delivery (legendary) | +0,5 |
| Master Builder (legendary), Prefab Parts, Handyman, Saucepan Helmet, Banana Peel | ±0 |

Óvissan er um ±1 bylgja á hvert perk. Sömu tvö perkin eru efst og í fyrri tilrauninni. **Smíðaperkin (Handyman, Prefab Parts og Master Builder) gera ekkert mælanlegt.**

## 5. Tillögur

**Nýju turnarnir þurfa styrkingu, svo blanda borgi sig:**
1. **Arcane:** +40–50% skaði, eða ódýrari (150 → 120). Seer þarf að halda meiri skaða.
2. **Tesla:** +50% skaði. Storm Coil ætti að missa minna á hverju hoppi (falloff 0,8 → 0,9).
3. **Alchemist:** eitrið mætti vera sterkara (9 → 13 dps). Plague Cask er fín.
4. **Watchtower:** ódýrari (110 → 80), svo það kosti minna að hafa hann „til öryggis“.
5. **Ballista:** ágæt eins og er. Siege Bolt er mjög sterk, og ýtingin er öflug.

**Óvinirnir:**
6. Nýju óvinarnir bættust ofan á gömlu bylgjurnar, svo bylgjurnar urðu stærri. Það mætti **skipta út hluta af Walkers** þegar nýju tegundirnar koma, eða lækka `hpGrowth` aðeins.

**Fyrri vandamál sem standa enn:**
7. Fire er sterkasti turninn.
8. Skotfærin skipta litlu máli (turnar tómir 0–3% af tímanum).
9. Perk um hlauparann sjálfan og smíðaperk gera lítið.
10. The Hollow og The Long March eru veggir fyrir nýjan commander.

**Botninn:** Smart velur rangt þegar margir turnar eru í boði. Næsta skref væri að stilla mat hans á hvern turn út frá matchup-töflunni, eða Monte Carlo-botn sem prófar áætlanir með hermun.

## Hvernig þetta var keyrt

```
node tools/matchup.js 1 12 1            # matchup, stig 1
node tools/matchup.js 8 12 25           # matchup, stig 8 með sérhæfingu
STATS=1 node tools/simulate.js 20 basic,smart,wide,tall,cheapest,focus,even,topdps,slowfirst,smart-noorders,smart-nospells,oldtowers,newtowers,lookahead,watchfirst 60 all
COMMANDER=mid node tools/simulate.js 8 basic,smart,oldtowers,newtowers,focus,cheapest 60 all
COMMANDER=strong node tools/simulate.js 8 basic,smart,oldtowers,newtowers,focus,cheapest 60 all
GRANTS=all node tools/simulate.js 20 oldtowers 60 oldroad
SWEEP='{"lineHits":[0.5,0.8,1.2],"sameTypeDecay":[0.5,0.8]}' node tools/simulate.js 20 smart 60 all
```

---

# Jafnvægisbreytingar (eftir skýrsluna)

| Breyting | Áður | Núna |
|---|---|---|
| Arcane: skaði / verð | 17 / 150 gull | **25 / 130 gull** |
| Arcane Seer: skaðaauki | +20% | **+40%** |
| Tesla: skaði / tap á hverju hoppi | 13 / 20% | **19 / 10%** |
| Alchemist: eitur | 9/s | **13/s** |
| Watchtower: verð | 110 | **80** |
| Ironclad: HP | 200 | **170** |
| Nýir óvinir á bylgju | Ironclad 1+0,4, Ghost 2+0,5, Wraith 2+0,5, Rotter 1+0,5 | **Ironclad 1+0,3, Ghost 1+0,4, Wraith 1+0,4, Rotter 1+0,4** |
| Botninn: Rolling Stone og Ballista | eitt sameiginlegt mat | **sitt matið hvort** (`rollerHits` 2,5, `lineHits` 0,8) |

Prófað en hætt við: að fækka Walkers (3 → 2,5 á bylgju) gerði leikinn **erfiðari**, ekki léttari. Walkers eru helsta gulltekjan í byrjun.

## Matchup eftir breytingarnar

| Turn (stig 1) | Walker | Runner | Brute | Ghost | Ironclad | Rotter |
|---|---:|---:|---:|---:|---:|---:|
| Fire | 96% | 90% | 36% | 78% | 64% | 52% |
| **Tesla Coil** | 100% (var 90%) | 100% (var 70%) | 36% (var 21%) | **98%** (var 63%) | 73% (var 36%) | 66% (var 41%) |
| **Alchemist** | 100% (var 88%) | 92% | 38% (var 28%) | 83% (var 67%) | 55% (var 37%) | 59% (var 43%) |
| **Arcane** | 76% (var 57%) | 85% (var 79%) | 18% (var 13%) | 55% (var 37%) | 36% (var 21%) | 33% (var 23%) |

Á stigi 8 er **Alchemist Plague Cask** orðin jafngóð Fire Inferno: 94% á Ghost, 80% á Ironclad og 76% á Rotter. Tesla Overload er nálægt.

## Aðferðir eftir breytingarnar (meðaltal allra korta)

| Aðferð | Nýr commander | Mið-commander | Sterkur commander |
|---|---:|---:|---:|
| Smart (allir 11 turnar) | 6,2 (var 6,4) | **17,2** (var 14,6) | 30,3 (var 30,8) |
| Bara gömlu turnarnir | **7,4** (var 7,3) | 16,8 (var 16,6) | **34,9** (var 34,6) |
| Bara nýju turnarnir | 5,5 (var 5,2) | 13,8 (var 12,0) | 30,0 (var 28,8) |

- **Með mið-commander er blandan nú best.** Smart með öllum turnum vinnur „gömlu turnana“, og nýju turnarnir einir eru miklu nær.
- Með nýjum og sterkum commander velur Smart enn of illa úr 11 turnum. Gömlu turnarnir einir eru betri þar, en það er dómgreind botnsins frekar en turnarnir sjálfir, því nýju turnarnir standast núna samanburð í matchup.
- Erfiðleikinn fyrir mið-commander: The Old Road ~23, Crossroads ~16, River Bend ~20, The Hollow ~12, The Long March ~13.
