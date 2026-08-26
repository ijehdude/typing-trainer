/**
 * Frequency-ranked English lexicon (~1000 words, descending frequency).
 * Rank position drives Zipf-weighted sampling in the word generator
 * (PRD §10.3): weight ∝ 1/rank. Curated from standard frequency lists;
 * lowercase alphabetic only — punctuation/casing are added by stage 4+.
 */
const WORDS =
  'the of and to in a is that it was for on are as with his they be at one ' +
  'have this from or had by word but not what all were when we there can an ' +
  'your which their said if do will each about how up out them then she many ' +
  'some so these would other into has more her two like him see time could no ' +
  'make than first been its who now people my made over did down only way find ' +
  'use may water long little very after called just where most know get ' +
  'through back much before go good new write our used me man too any day same ' +
  'right look think also around another came come work three must because does ' +
  'part even place well such here take why things help put years different ' +
  'away again off went old number great tell men say small every found still ' +
  'between name should home big give air line set own under read last never us ' +
  'left end along while might next sound below saw something thought both few ' +
  'those always looked show large often together asked house world going want ' +
  'school important until form food keep children feet land side without boy ' +
  'once animals life enough took sometimes four head above kind began almost ' +
  'live page got earth need far hand high year mother light parts country ' +
  'father let night following picture being study second eyes soon times story ' +
  'boys since white days ever paper hard near sentence better best across ' +
  'during today others however sure means knew try told young miles sun ways ' +
  'thing whole hear example heard several change answer room against top ' +
  'turned three learn point city play toward five using himself usually money ' +
  'seen car morning long body upon family later turn move face door cut done ' +
  'group true half red fish plants living black eat short united run book gave ' +
  'order open ground cold really table remember tree course front american ' +
  'space inside ago sad early ill learned brought close nothing though idea ' +
  'before lived became add become grow draw yet less wind behind cannot ' +
  'letter among able dog shown mean english rest perhaps certain six feel fire ' +
  'ready green yes built special ran full town complete oh person hot anything ' +
  'hold state list stood hundred ten fast felt kept notice cant strong voice ' +
  'probably area horse matter stand box start that potatoes bring warm common ' +
  'bright leaves surface quickly song check moon outside covered wonder ' +
  'plain figure stars front waves rock done england beautiful heat pattern ' +
  'clear held describe product happened whether snow past bank quite ' +
  'reached government tiny possible heart real simple south leave problem ' +
  'piece told usual friends easy heavy taken hours glass known war lay weather ' +
  'root instruments meet third months paragraph raised represent soft whose ' +
  'moment stay column village wild deep wall track shall held circle include ' +
  'built cost maybe business separate break uncle hunting flow lady students ' +
  'human art feeling supply corner electric insects crops tone hit sand ' +
  'doctor provide thus wont cool cause please operate ocean speed trip nine ' +
  'wheel free plane system behind range steel plan clothes proud value wife ' +
  'sharp company radio glad receive nation blue rather instead question wrote ' +
  'method fig king size vary happy machine gone yellow silent trade rather ' +
  'consonant either total deal determine evening nor rope cotton apple ' +
  'details entire compound smell arms decided position direct produce nature ' +
  'level truck laughed history effect underline view sign else century else ' +
  'gas fact process million bed board pair spread rolled bear wonder smiled ' +
  'angle fraction race window difficult present result jumped visit type ' +
  'president brown edge law seeds increase interest sister train middle mine ' +
  'winter wide written length reason kept summer lake moved son bird brother ' +
  'garden race farm anyone force test store shoulder industry wash blocks ' +
  'spot legs sat main north dance rule science afraid women speak eight ' +
  'produce pull son mean clean visit dark ball material special heavy fine ' +
  'pair circle spent maybe circle skin bought led pitch count ice although ' +
  'stream finally lot indeed act rhythm exercise arms lifted married suddenly ' +
  'chief japanese factories mall mount region grew skin valley type factors ' +
  'gold soldiers guess silent chance located sir gone save met seven build ' +
  'poem trouble border object age minutes teacher string dollars send sight ' +
  'chief drive wing capital speak cover fresh block japan dictionary spring ' +
  'weight prepared pretty solution fair printed cool shape corn wouldnt ' +
  'shop suffix especially shoes actually nose afternoon silver dead weight ' +
  'rose alone drawing sit contrast eastern experiment tools engine cattle ' +
  'die hair century melody stone division touch information express section';

let cached: string[] | null = null;

/** Words in frequency order, de-duplicated (first occurrence keeps its rank). */
export function lexicon(): readonly string[] {
  if (!cached) {
    const seen = new Set<string>();
    cached = WORDS.split(/\s+/).filter((w) => {
      if (w.length === 0 || seen.has(w)) return false;
      seen.add(w);
      return true;
    });
  }
  return cached;
}

/** Zipf weight for a word at frequency rank r (0-based): 1/(r+1). */
export function zipfWeight(rank: number): number {
  return 1 / (rank + 1);
}
