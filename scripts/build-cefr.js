/**
 * 建立完整 CEFR 詞表
 * 以 Oxford 5000 / NGSL 公開資料為基礎，合併現有 853 個詞
 * 執行：node scripts/build-cefr.js
 */

const fs = require('fs');
const path = require('path');

// ── 現有詞表（保留） ──────────────────────────────────────────────────────────
const existing = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../src/data/cefr-wordlist.json'), 'utf-8')
);

// ── 補充詞表（Oxford 5000 / NGSL 常見詞） ──────────────────────────────────────
// 僅列入現有表中「缺漏」的詞，避免覆蓋已有正確等級

const supplement = {
  // ── A1 ─────────────────────────────────────────────────────────────────────
  // 人稱代名詞（雖在 stopWords 過濾，仍需正確等級供 not-A1 規則使用）
  he:'A1', him:'A1', his:'A1', himself:'A1',
  she:'A1', her:'A1', herself:'A1',
  they:'A1', them:'A1', their:'A1', themselves:'A1',
  we:'A1', us:'A1', our:'A1', ourselves:'A1',
  you:'A1', your:'A1', yourself:'A1', yourselves:'A1',
  i:'A1', me:'A1', my:'A1', myself:'A1',
  it:'A1', its:'A1', itself:'A1',
  who:'A1', what:'A1', which:'A1', whose:'A1', whom:'A1',

  // 家庭
  father:'A1', mother:'A1', son:'A1', daughter:'A1',
  brother:'A1', sister:'A1', child:'A1', baby:'A1',
  boy:'A1', girl:'A1', man:'A1', woman:'A1', person:'A1',
  family:'A1', parent:'A1', husband:'A1', wife:'A1',
  grandfather:'A1', grandmother:'A1', uncle:'A1', aunt:'A1',

  // 身體
  body:'A1', head:'A1', face:'A1', hand:'A1',
  eye:'A1', ear:'A1', nose:'A1', mouth:'A1', lip:'A1',
  arm:'A1', leg:'A1', foot:'A1', back:'A1', shoulder:'A1',
  finger:'A1', thumb:'A1', toe:'A1', knee:'A1', chest:'A1',
  neck:'A1', skin:'A1', bone:'A1', blood:'A1', hair:'A1',
  heart:'A1', stomach:'A1', brain:'A1',

  // 自然
  sky:'A1', sun:'A1', moon:'A1', star:'A1', cloud:'A1',
  rain:'A1', snow:'A1', wind:'A1', storm:'A1',
  water:'A1', fire:'A1', earth:'A1', stone:'A1', rock:'A1',
  sand:'A1', mud:'A1', ice:'A1', air:'A1',
  tree:'A1', flower:'A1', grass:'A1', leaf:'A1', wood:'A1',
  mountain:'A1', hill:'A1', river:'A1', lake:'A1', sea:'A1',
  forest:'A1', field:'A1', ground:'A1', land:'A1', soil:'A1',
  path:'A1', road:'A1', bridge:'A1', valley:'A1',

  // 動物
  horse:'A1', dog:'A1', cat:'A1', bird:'A1', fish:'A1',
  bear:'A1', wolf:'A1', deer:'A1', rabbit:'A1', cow:'A1',
  pig:'A1', sheep:'A1', lion:'A1', tiger:'A1', eagle:'A1',
  snake:'A1', dragon:'A1',

  // 建築 / 場所
  house:'A1', home:'A1', room:'A1', door:'A1', window:'A1',
  wall:'A1', floor:'A1', roof:'A1', stair:'A1', gate:'A1',
  street:'A1', town:'A1', village:'A1', city:'A1', castle:'A1',
  church:'A1', school:'A1', market:'A1', shop:'A1', inn:'A1',
  tavern:'A1', tower:'A1', bridge:'A1',

  // 物品
  book:'A1', bag:'A1', box:'A1', cup:'A1', plate:'A1',
  table:'A1', chair:'A1', bed:'A1', lamp:'A1', key:'A1',
  rope:'A1', ring:'A1', cloth:'A1', coat:'A1', boot:'A1',
  sword:'A1', knife:'A1', axe:'A1', bow:'A1', arrow:'A1',
  ship:'A1', boat:'A1', wheel:'A1', cart:'A1',

  // 食物 / 飲料
  bread:'A1', meat:'A1', fish:'A1', egg:'A1', milk:'A1',
  water:'A1', wine:'A1', ale:'A1', food:'A1', meal:'A1',

  // 基礎名詞（抽象）
  time:'A1', day:'A1', night:'A1', morning:'A1', evening:'A1',
  year:'A1', week:'A1', hour:'A1', moment:'A1', second:'A1',
  way:'A1', side:'A1', end:'A1', part:'A1', kind:'A1',
  name:'A1', word:'A1', life:'A1', world:'A1', place:'A1',
  thing:'A1', matter:'A1', point:'A1', line:'A1', group:'A1',
  voice:'A1', sound:'A1', light:'A1', dark:'A1', color:'A1',
  sense:'A1', pain:'A1', power:'A1', force:'A1', need:'A1',
  lot:'A1', bit:'A1', piece:'A1', top:'A1', bottom:'A1',
  front:'A1', back:'A1', center:'A1', middle:'A1', edge:'A1',

  // 基礎動詞
  go:'A1', come:'A1', get:'A1', give:'A1', take:'A1',
  make:'A1', see:'A1', know:'A1', find:'A1', think:'A1',
  look:'A1', want:'A1', say:'A1', tell:'A1', ask:'A1',
  feel:'A1', try:'A1', leave:'A1', put:'A1', use:'A1',
  call:'A1', keep:'A1', let:'A1', begin:'A1', start:'A1',
  show:'A1', hear:'A1', play:'A1', run:'A1', walk:'A1',
  move:'A1', live:'A1', bring:'A1', happen:'A1', stand:'A1',
  lose:'A1', pay:'A1', meet:'A1', help:'A1', stop:'A1',
  fall:'A1', turn:'A1', write:'A1', read:'A1', speak:'A1',
  open:'A1', close:'A1', cut:'A1', hold:'A1', sit:'A1',
  reach:'A1', pull:'A1', push:'A1', throw:'A1', catch:'A1',
  set:'A1', buy:'A1', draw:'A1', drive:'A1', eat:'A1',
  win:'A1', die:'A1', fight:'A1', kill:'A1', hit:'A1',
  ride:'A1', climb:'A1', jump:'A1', fly:'A1', carry:'A1',
  sleep:'A1', wake:'A1', wait:'A1', watch:'A1', follow:'A1',
  lead:'A1', return:'A1', step:'A1', cross:'A1', raise:'A1',
  drop:'A1', pick:'A1', touch:'A1', grab:'A1', move:'A1',
  enter:'A1', leave:'A1', pass:'A1', rise:'A1',

  // 基礎形容詞
  big:'A1', small:'A1', large:'A1', little:'A1',
  long:'A1', short:'A1', tall:'A1', high:'A1', low:'A1',
  wide:'A1', deep:'A1', thin:'A1', thick:'A1',
  old:'A1', young:'A1', new:'A1', early:'A1', late:'A1',
  good:'A1', bad:'A1', great:'A1', right:'A1', wrong:'A1',
  true:'A1', real:'A1', sure:'A1', certain:'A1', possible:'A1',
  same:'A1', different:'A1', other:'A1', next:'A1', last:'A1',
  first:'A1', only:'A1', own:'A1', whole:'A1', every:'A1',
  open:'A1', closed:'A1', full:'A1', empty:'A1', free:'A1',
  hard:'A1', soft:'A1', hot:'A1', cold:'A1', warm:'A1', cool:'A1',
  fast:'A1', slow:'A1', quick:'A1', light:'A1', heavy:'A1',
  dark:'A1', bright:'A1', white:'A1', black:'A1', red:'A1',
  blue:'A1', green:'A1', yellow:'A1', brown:'A1', grey:'A1',
  dead:'A1', alive:'A1', safe:'A1', ready:'A1', close:'A1',
  near:'A1', far:'A1', alone:'A1', still:'A1', strong:'A1',
  weak:'A1', sick:'A1', hurt:'A1', tired:'A1', afraid:'A1',
  happy:'A1', sad:'A1', angry:'A1', brave:'A1', wise:'A1',
  strange:'A1', pale:'A1', quiet:'A1', loud:'A1', wild:'A1',

  // 數字 / 量詞
  one:'A1', two:'A1', three:'A1', four:'A1', five:'A1',
  six:'A1', seven:'A1', eight:'A1', nine:'A1', ten:'A1',
  hundred:'A1', thousand:'A1', million:'A1', zero:'A1', half:'A1',
  first:'A1', second:'A1', third:'A1', fourth:'A1', fifth:'A1',
  dozen:'A1', pair:'A1', few:'A1', many:'A1', several:'A1',
  number:'A1', count:'A1',

  // 複合不定代名詞
  something:'A1', nothing:'A1', anything:'A1', everything:'A1',
  someone:'A1', anyone:'A1', everyone:'A1', nobody:'A1', somebody:'A1',
  somewhere:'A1', anywhere:'A1', everywhere:'A1', nowhere:'A1',
  somehow:'A1', sometime:'A1', sometimes:'A1', whenever:'A1', wherever:'A1',

  // 基礎副詞
  again:'A1', already:'A1', also:'A1', always:'A1',
  away:'A1', back:'A1', down:'A1', up:'A1',
  ever:'A1', even:'A1', enough:'A1', finally:'A1',
  here:'A1', there:'A1', home:'A1',
  just:'A1', never:'A1', now:'A1', once:'A1', only:'A1',
  out:'A1', quite:'A1', rather:'A1', really:'A1',
  so:'A1', soon:'A1', still:'A1', then:'A1', too:'A1',
  very:'A1', well:'A1', yet:'A1', forward:'A1', ahead:'A1',
  around:'A1', together:'A1', along:'A1', off:'A1', over:'A1',
  through:'A1', across:'A1', inside:'A1', outside:'A1',

  // 基礎介系詞 / 連詞（雖為功能詞，提供等級供需要時使用）
  about:'A1', above:'A1', after:'A1', against:'A1',
  before:'A1', behind:'A1', below:'A1', beside:'A1',
  between:'A1', beyond:'A1', during:'A1', except:'A1',
  from:'A1', into:'A1', near:'A1', off:'A1', onto:'A1',
  since:'A1', than:'A1', through:'A1', toward:'A1',
  under:'A1', until:'A1', upon:'A1', within:'A1', without:'A1',

  // ── A2 ─────────────────────────────────────────────────────────────────────
  // 小說常見 A2 詞彙
  // 常見 A2 形容詞（補漏）
  human:'A2', such:'A2', gentle:'A2', certain:'A2', possible:'A2',
  natural:'A2', physical:'A2', personal:'A2', social:'A2', special:'A2',
  local:'A2', national:'A2', common:'A2', general:'A2', normal:'A2',
  serious:'A2', terrible:'A2', horrible:'A2', awful:'A2', excellent:'A2',
  perfect:'A2', complete:'A2', total:'A2', final:'A2', main:'A2',
  single:'A2', double:'A2', simple:'A2', basic:'A2', similar:'A2',
  likely:'A2', alone:'A2', asleep:'A2', aware:'A2', unable:'A2',
  ready:'A2', worth:'A2', actual:'A2', recent:'A2', direct:'A2',

  // 常見 A2 名詞（補漏）
  form:'A2', sight:'A2', tear:'A2', faith:'A2', edge:'A2', ridge:'A2',
  spirit:'A2', force:'A2', power:'A2', strength:'A2', ability:'A2',
  fear:'A2', hope:'A2', truth:'A2', fact:'A2', reason:'A2',
  thought:'A2', feeling:'A2', mind:'A2', heart:'A2', soul:'A2',
  pain:'A2', danger:'A2', chance:'A2', choice:'A2', deal:'A2',
  sense:'A2', moment:'A2', period:'A2', space:'A2', distance:'A2',
  direction:'A2', position:'A2', surface:'A2', shape:'A2', size:'A2',
  age:'A2', health:'A2', rest:'A2', breath:'A2', step:'A2', move:'A2',
  sign:'A2', mark:'A2', color:'A2', smell:'A2', taste:'A2',
  pattern:'A2', example:'A2', situation:'A2', condition:'A2', event:'A2',
  type:'A2', amount:'A2', level:'A2', rate:'A2', number:'A2', degree:'A2',

  // 常見 A2 副詞（補漏）
  perhaps:'A2', maybe:'A2', probably:'A2', almost:'A2', nearly:'A2',
  instead:'A2', suddenly:'A2', immediately:'A2', quickly:'A2', slowly:'A2',
  quietly:'A2', carefully:'A2', easily:'A2', clearly:'A2', simply:'A2',
  exactly:'A2', directly:'A2', seriously:'A2', completely:'A2', certainly:'A2',
  especially:'A2', particularly:'A2', slightly:'A2', mostly:'A2', mainly:'A2',
  recently:'A2', suddenly:'A2', finally:'A2', actually:'A2', usually:'A2',

  // 常見 A2 動詞（補漏）
  become:'A2', appear:'A2', remain:'A2', continue:'A2', seem:'A2',
  allow:'A2', prevent:'A2', force:'A2', cause:'A2', affect:'A2',
  support:'A2', avoid:'A2', prepare:'A2', attempt:'A2', manage:'A2',
  notice:'A2', realize:'A2', recognize:'A2', remember:'A2', forget:'A2',
  wonder:'A2', hope:'A2', wish:'A2', decide:'A2', choose:'A2', agree:'A2',
  accept:'A2', refuse:'A2', offer:'A2', suggest:'A2', expect:'A2',
  prefer:'A2', enjoy:'A2', hate:'A2', love:'A2', need:'A2', miss:'A2',
  laugh:'A2', cry:'A2', smile:'A2', shout:'A2', whisper:'A2', nod:'A2',
  shake:'A2', rise:'A2', drop:'A2', bend:'A2', lean:'A2', stretch:'A2',

  guard:'A2', soldier:'A2', knight:'A2', warrior:'A2',
  chief:'A2', lord:'A2', prince:'A2', princess:'A2', queen:'A2', king:'A2',
  master:'A2', servant:'A2', slave:'A2', apprentice:'A2', student:'A2',
  teacher:'A2', leader:'A2', follower:'A2', stranger:'A2', traveler:'A2',
  captain:'A2', soldier:'A2', enemy:'A2', army:'A2', battle:'A2',
  camp:'A2', weapon:'A2', shield:'A2', armor:'A2', spear:'A2',
  magic:'A2', spirit:'A2', soul:'A2', ghost:'A2', demon:'A2',
  angel:'A2', god:'A2', goddess:'A2', monk:'A2', priest:'A2',
  wizard:'A2', witch:'A2', monster:'A2', creature:'A2', beast:'A2',
  giant:'A2', dwarf:'A2', elf:'A2', goblin:'A2',

  anger:'A2', fear:'A2', joy:'A2', hope:'A2', grief:'A2',
  sorrow:'A2', guilt:'A2', shame:'A2', pride:'A2', hate:'A2',
  love:'A2', desire:'A2', courage:'A2', honor:'A2', glory:'A2',

  shadow:'A2', darkness:'A2', silence:'A2', peace:'A2', war:'A2',
  death:'A2', birth:'A2', dream:'A2', vision:'A2', memory:'A2',
  truth:'A2', lie:'A2', secret:'A2', mystery:'A2', danger:'A2',
  safety:'A2', freedom:'A2', destiny:'A2', fate:'A2', luck:'A2',

  journey:'A2', quest:'A2', adventure:'A2', mission:'A2',
  enemy:'A2', ally:'A2', companion:'A2', hero:'A2', villain:'A2',
  battle:'A2', fight:'A2', victory:'A2', defeat:'A2', escape:'A2',

  answer:'A2', question:'A2', plan:'A2', idea:'A2', decision:'A2',
  order:'A2', command:'A2', warning:'A2', promise:'A2', message:'A2',
  news:'A2', story:'A2', tale:'A2', history:'A2', legend:'A2',

  nature:'A2', weather:'A2', season:'A2', spring:'A2', summer:'A2',
  autumn:'A2', winter:'A2', dawn:'A2', dusk:'A2', noon:'A2',
  midnight:'A2', sunrise:'A2', sunset:'A2',

  silver:'A2', gold:'A2', iron:'A2', steel:'A2', copper:'A2',
  gem:'A2', crystal:'A2', flame:'A2', smoke:'A2', dust:'A2',
  ash:'A2', mist:'A2', fog:'A2', shadow:'A2',

  camp:'A2', tent:'A2', fire:'A2', torch:'A2', lantern:'A2',
  hall:'A2', throne:'A2', dungeon:'A2', prison:'A2',
  temple:'A2', altar:'A2', shrine:'A2', tomb:'A2',

  wound:'A2', blood:'A2', scar:'A2', bruise:'A2', heal:'A2',
  medicine:'A2', poison:'A2', death:'A2',

  laugh:'A2', cry:'A2', scream:'A2', shout:'A2', whisper:'A2',
  smile:'A2', frown:'A2', nod:'A2', bow:'A2', kneel:'A2',
  tremble:'A2', shiver:'A2', freeze:'A2', shake:'A2', sway:'A2',
  lean:'A2', bend:'A2', stretch:'A2', crouch:'A2',

  cover:'A2', hide:'A2', search:'A2', hunt:'A2', chase:'A2',
  attack:'A2', defend:'A2', protect:'A2', save:'A2', rescue:'A2',
  capture:'A2', release:'A2', free:'A2', unlock:'A2',
  gather:'A2', collect:'A2', build:'A2', destroy:'A2', break:'A2',
  pull:'A2', push:'A2', lift:'A2', carry:'A2', throw:'A2',
  send:'A2', receive:'A2', share:'A2', trade:'A2', steal:'A2',

  trust:'A2', doubt:'A2', believe:'A2', hope:'A2', wish:'A2',
  fear:'A2', worry:'A2', wonder:'A2', guess:'A2', realize:'A2',
  understand:'A2', learn:'A2', teach:'A2', remember:'A2', forget:'A2',
  imagine:'A2', dream:'A2', choose:'A2', decide:'A2', accept:'A2',
  refuse:'A2', agree:'A2', disagree:'A2', argue:'A2', convince:'A2',

  strange:'A2', ancient:'A2', holy:'A2', sacred:'A2', cursed:'A2',
  powerful:'A2', magical:'A2', evil:'A2', noble:'A2', brave:'A2',
  loyal:'A2', faithful:'A2', proud:'A2', humble:'A2', clever:'A2',
  swift:'A2', sharp:'A2', clear:'A2', pure:'A2', simple:'A2',
  rough:'A2', smooth:'A2', flat:'A2', round:'A2', straight:'A2',
  crooked:'A2', narrow:'A2', broad:'A2', steep:'A2', dense:'A2',
  empty:'A2', full:'A2', rich:'A2', poor:'A2', hungry:'A2', thirsty:'A2',
  weary:'A2', steady:'A2', sudden:'A2', silent:'A2', calm:'A2',
  nervous:'A2', excited:'A2', curious:'A2', confused:'A2', surprised:'A2',
  pleased:'A2', disappointed:'A2', determined:'A2', careful:'A2',

  quickly:'A2', slowly:'A2', quietly:'A2', suddenly:'A2', finally:'A2',
  immediately:'A2', suddenly:'A2', nearly:'A2', almost:'A2', hardly:'A2',
  deeply:'A2', clearly:'A2', simply:'A2', exactly:'A2', directly:'A2',
  carefully:'A2', quickly:'A2', gently:'A2', firmly:'A2', swiftly:'A2',

  // ── A1 補充（lemmatizer 邊界案例：adjective/gerund 形式不還原到基本詞） ──────
  // 方向詞（A1）
  north:'A1', south:'A1', east:'A1', west:'A1',
  northeast:'A1', northwest:'A1', southeast:'A1', southwest:'A1',
  // 常見「不會被 lemmatize 到基本形」的 A1 詞
  others:'A1', done:'A1', least:'A1', cannot:'A1', less:'A1',
  none:'A1', neither:'A1', nor:'A1', both:'A1', either:'A1',
  much:'A1', each:'A1', another:'A1', else:'A1', enough:'A1',
  // 常見 A1 詞（副詞、量詞等）
  forth:'A1', hence:'A1', thus:'A1', thereby:'A1',

  // ── A2 補充（常用動詞 / 名詞 / 副詞）──────────────────────────────────────
  // 常見 A2 動詞
  note:'A2', notice:'A2', reply:'A2', respond:'A2', answer:'A2',
  roll:'A2', slip:'A2', spin:'A2', swing:'A2', wave:'A2',
  pause:'A2', glance:'A2', stare:'A2', gaze:'A2', peek:'A2',
  add:'A2', care:'A2', kick:'A2', kiss:'A2', view:'A2', snap:'A2',
  club:'A2', hop:'A2', skip:'A2', skip:'A2', dip:'A2', tap:'A2',
  rub:'A2', pat:'A2', wipe:'A2', clean:'A2', wash:'A2', dry:'A2',
  wrap:'A2', fold:'A2', tie:'A2', knot:'A2', fix:'A2', lock:'A2',
  fill:'A2', pour:'A2', mix:'A2', stir:'A2', cook:'A2', bake:'A2',
  press:'A2', squeeze:'A2', pinch:'A2', grip:'A2', clench:'A2',
  flash:'A2', glow:'A2', shine:'A2', flicker:'A2', blink:'A2',
  thud:'A2', crash:'A2', rumble:'A2', growl:'A2', roar:'A2',
  hiss:'A2', screech:'A2', hum:'A2', buzz:'A2', ring:'A2',
  rush:'A2', dash:'A2', sprint:'A2', charge:'A2', flee:'A2',
  crawl:'A2', creep:'A2', sneak:'A2', creep:'A2', limp:'A2',
  collapse:'A2', stumble:'A2', stagger:'A2', sway:'A2', trip:'A2',

  // 常見 A2 名詞
  spot:'A2', image:'A2', course:'A2', class:'A2',
  angle:'A2', wing:'A2', corner:'A2', mile:'A2',
  blade:'A2', hilt:'A2', staff:'A2', cloak:'A2', hood:'A2',
  pouch:'A2', flask:'A2', pack:'A2', sack:'A2',
  patch:'A2', scrap:'A2', bundle:'A2', pile:'A2', heap:'A2',
  gap:'A2', crack:'A2', hole:'A2', pit:'A2', cliff:'A2',
  slope:'A2', peak:'A2', shore:'A2', bay:'A2', cove:'A2',
  marsh:'A2', plain:'A2', meadow:'A2', thicket:'A2', grove:'A2',
  fog:'A2', mist:'A2', haze:'A2', gloom:'A2', gleam:'A2',
  flame:'A2', ash:'A2', coal:'A2', ember:'A2', spark:'A2',
  pine:'A2', oak:'A2', birch:'A2', maple:'A2', cedar:'A2',
  hawk:'A2', crow:'A2', owl:'A2', dove:'A2', swan:'A2', raven:'A2',
  bone:'A2', claw:'A2', fang:'A2', tail:'A2', scale:'A2',
  folk:'A2', crew:'A2', tribe:'A2', band:'A2', pack:'A2',
  cave:'A2', den:'A2', lair:'A2', nest:'A2', burrow:'A2',
  score:'A2', count:'A2', rank:'A2', grade:'A2', class:'A2',
  tone:'A2', note:'A2', sound:'A2', beat:'A2', rhythm:'A2',
  mark:'A2', seal:'A2', brand:'A2', sign:'A2', signal:'A2',
  deck:'A2', mast:'A2', hull:'A2', sail:'A2', anchor:'A2',
  club:'A2', staff:'A2', rod:'A2', pole:'A2', stake:'A2',
  cape:'A2', cloak:'A2', vest:'A2', belt:'A2', strap:'A2',
  dagger:'A2', lance:'A2', mace:'A2', shield:'A2', helm:'A2',
  trail:'A2', track:'A2', path:'A2', route:'A2', course:'A2',
  tip:'A2', edge:'A2', point:'A2', end:'A2', top:'A2', base:'A2',
  inch:'A2', foot:'A1', yard:'A2', pace:'A2', span:'A2',
  gray:'A2', grey:'A2', scarlet:'A2', crimson:'A2', azure:'A2',

  // 常見 A2 形容詞
  huge:'A2', tiny:'A2', tight:'A2', loose:'A2',
  dry:'A2', wet:'A2', damp:'A2', sticky:'A2', muddy:'A2',
  smooth:'A2', rough:'A2', sharp:'A2', dull:'A2', blunt:'A2',
  hollow:'A2', solid:'A2', dense:'A2', sparse:'A2', thick:'A2',
  steep:'A2', flat:'A2', level:'A2', sloped:'A2', curved:'A2',
  distant:'A2', nearby:'A2', hidden:'A2', visible:'A2',
  faint:'A2', dim:'A2', misty:'A2', clear:'A2', hazy:'A2',
  frozen:'A2', melted:'A2', burning:'A2', smoking:'A2', glowing:'A2',
  limp:'A2', stiff:'A2', numb:'A2', sore:'A2', aching:'A2',
  awake:'A2', asleep:'A2', alive:'A2', alone:'A2', apart:'A2',
  careful:'A2', careless:'A2', fearless:'A2', helpless:'A2', hopeless:'A2',
  useless:'A2', worthless:'A2', harmless:'A2', restless:'A2', restless:'A2',
  sudden:'A2', immediate:'A2', constant:'A2', steady:'A2', rapid:'A2',
  gentle:'A2', tender:'A2', harsh:'A2', firm:'A2', rigid:'A2',
  plain:'A2', simple:'A2', bare:'A2', empty:'A2', clean:'A2',
  golden:'A2', silver:'A2', wooden:'A2', stone:'A2', iron:'A2',
  local:'A2', foreign:'A2', distant:'A2', ancient:'A2', modern:'A2',

  // 常見 A2 副詞
  surely:'A2', truly:'A2', clearly:'A2', perfectly:'A2', obviously:'A2',
  forth:'A2', yet:'A2', anymore:'A2', awhile:'A2', aside:'A2',
  nearby:'A2', apart:'A2', ahead:'A2', behind:'A2', below:'A2',
  above:'A2', within:'A2', beyond:'A2', throughout:'A2', elsewhere:'A2',

  // ── B1 ─────────────────────────────────────────────────────────────────────
  // B1 補充（常用但較難的詞）
  indeed:'B1', remark:'B1', patrol:'B1', abbey:'B1', passage:'B1',
  strike:'B1', leap:'B1', motion:'B1', movement:'B1', expression:'B1',
  blow:'B1', burn:'B1', shift:'B1', pace:'B1', muscle:'B1',
  none:'B1', duty:'B1', howl:'B1', snap:'B1', protest:'B1',
  shrug:'B1', admit:'B1', crew:'B1', branch:'B1', view:'B1',
  dagger:'B1', less:'B1', tone:'B1', forth:'B1',

  // B1 動詞
  stalk:'B1', lurk:'B1', crouch:'B1', pounce:'B1', lunge:'B1',
  dodge:'B1', parry:'B1', thrust:'B1', slash:'B1', hack:'B1',
  pierce:'B1', wound:'B1', maim:'B1', cripple:'B1', slay:'B1',
  absorb:'B1', deflect:'B1', evade:'B1', intercept:'B1',
  summon:'B1', invoke:'B1', channel:'B1', wield:'B1', conjure:'B1',
  scatter:'B1', shatter:'B1', rupture:'B1', fracture:'B1', crumble:'B1',
  soar:'B1', descend:'B1', drift:'B1', hover:'B1', glide:'B1',
  sink:'B1', plunge:'B1', submerge:'B1', surface:'B1', emerge:'B1',
  falter:'B1', waver:'B1', hesitate:'B1', pause:'B1', halt:'B1',
  signal:'B1', gesture:'B1', indicate:'B1', point:'B1', beckon:'B1',
  grasp:'B1', seize:'B1', snatch:'B1', clutch:'B1', release:'B1',

  // B1 名詞
  ridge:'B1', vale:'B1', ravine:'B1', gorge:'B1', canyon:'B1',
  bluff:'B1', promontory:'B1', peninsula:'B1', archipelago:'B1',
  wilderness:'B1', badlands:'B1', tundra:'B1', steppe:'B1', moor:'B1',
  copse:'B1', glade:'B1', canopy:'B1', undergrowth:'B1', shrub:'B1',
  torrent:'B1', cascade:'B1', rapids:'B1', estuary:'B1', tributary:'B1',
  novice:'B1', apprentice:'B1', initiate:'B1', acolyte:'B1',
  rogue:'B1', thief:'B1', assassin:'B1', bandit:'B1', outlaw:'B1',
  bounty:'B1', loot:'B1', plunder:'B1', ransom:'B1', tribute:'B1',
  anguish:'B1', torment:'B1', agony:'B1', misery:'B1', suffering:'B1',
  valor:'B1', chivalry:'B1', gallantry:'B1', fealty:'B1', covenant:'B1',
  parchment:'B1', scroll:'B1', tome:'B1', manuscript:'B1', chronicle:'B1',

  // B1 形容詞
  vivid:'B1', keen:'B1', acute:'B1', intense:'B1', severe:'B1',
  massive:'B1', immense:'B1', vast:'B1', enormous:'B1', colossal:'B1',
  dim:'B1', dull:'B1', murky:'B1', turbid:'B1', opaque:'B1',
  agile:'B1', nimble:'B1', lithe:'B1', supple:'B1', dexterous:'B1',
  wary:'B1', vigilant:'B1', alert:'B1', cautious:'B1',
  defiant:'B1', resolute:'B1', steadfast:'B1', unwavering:'B1',
  hollow:'B1', gaunt:'B1', haggard:'B1', pallid:'B1', ashen:'B1',
  jagged:'B1', gnarled:'B1', twisted:'B1', warped:'B1', mangled:'B1',

  // B1 副詞
  merely:'B1', solely:'B1', barely:'B1', scarcely:'B1', hardly:'B1',
  swiftly:'B1', briskly:'B1', nimbly:'B1', boldly:'B1', fiercely:'B1',
  dimly:'B1', faintly:'B1', vaguely:'B1', vividly:'B1', clearly:'B1',

  indeed:'B1', remark:'B1', patrol:'B1', abbey:'B1', passage:'B1',
  chamber:'B1', tunnel:'B1', corridor:'B1', vault:'B1', gate:'B1',
  guard:'B1', ward:'B1', district:'B1', region:'B1', province:'B1',
  quarter:'B1', settlement:'B1', outpost:'B1', fortress:'B1', citadel:'B1',

  approach:'B1', advance:'B1', retreat:'B1', withdraw:'B1', charge:'B1',
  assault:'B1', siege:'B1', ambush:'B1', raid:'B1', skirmish:'B1',
  recruit:'B1', train:'B1', drill:'B1', discipline:'B1', rank:'B1',
  command:'B1', order:'B1', strategy:'B1', tactic:'B1', formation:'B1',

  wound:'B1', injure:'B1', recover:'B1', heal:'B1', tend:'B1',
  cure:'B1', treat:'B1', bind:'B1', bandage:'B1', nurse:'B1',

  reveal:'B1', conceal:'B1', expose:'B1', discover:'B1', uncover:'B1',
  detect:'B1', track:'B1', trace:'B1', locate:'B1', identify:'B1',
  examine:'B1', inspect:'B1', analyze:'B1', assess:'B1', judge:'B1',
  estimate:'B1', measure:'B1', observe:'B1', monitor:'B1', witness:'B1',

  gather:'B1', assemble:'B1', collect:'B1', accumulate:'B1', store:'B1',
  distribute:'B1', scatter:'B1', spread:'B1', arrange:'B1', organize:'B1',
  prepare:'B1', equip:'B1', supply:'B1', provide:'B1', deliver:'B1',

  bond:'B1', link:'B1', connect:'B1', bind:'B1', tie:'B1', chain:'B1',
  unite:'B1', divide:'B1', separate:'B1', isolate:'B1', confine:'B1',

  whisper:'B1', murmur:'B1', mutter:'B1', announce:'B1', declare:'B1',
  proclaim:'B1', warn:'B1', threaten:'B1', beg:'B1', plead:'B1',
  swear:'B1', vow:'B1', pledge:'B1', promise:'B1', bargain:'B1',

  mercy:'B1', justice:'B1', wisdom:'B1', loyalty:'B1', betrayal:'B1',
  alliance:'B1', council:'B1', throne:'B1', kingdom:'B1', empire:'B1',
  realm:'B1', territory:'B1', border:'B1', frontier:'B1',
  prophecy:'B1', omen:'B1', curse:'B1', blessing:'B1',
  ritual:'B1', ceremony:'B1', tradition:'B1', custom:'B1',
  clan:'B1', tribe:'B1', race:'B1', lineage:'B1', heir:'B1',

  atmosphere:'B1', crisis:'B1', event:'B1', incident:'B1', issue:'B1',
  factor:'B1', feature:'B1', function:'B1', impact:'B1', influence:'B1',
  method:'B1', process:'B1', result:'B1', role:'B1', source:'B1',
  stage:'B1', structure:'B1', symbol:'B1', theme:'B1', aspect:'B1',
  context:'B1', contrast:'B1', consequence:'B1', condition:'B1',

  patience:'B1', endurance:'B1', sacrifice:'B1', responsibility:'B1',
  burden:'B1', regret:'B1', relief:'B1', frustration:'B1',
  temptation:'B1', obsession:'B1', despair:'B1', anguish:'B1',
  compassion:'B1', sympathy:'B1', empathy:'B1', contempt:'B1',

  instinct:'B1', instinct:'B1', impulse:'B1', motivation:'B1',
  intention:'B1', suspicion:'B1', assumption:'B1', conclusion:'B1',
  perception:'B1', awareness:'B1', attention:'B1', focus:'B1',

  pursue:'B1', persist:'B1', endure:'B1', resist:'B1', challenge:'B1',
  confront:'B1', overcome:'B1', survive:'B1', struggle:'B1',
  suffer:'B1', sacrifice:'B1', betray:'B1', deceive:'B1', manipulate:'B1',
  threaten:'B1', negotiate:'B1', consult:'B1', observe:'B1',
  investigate:'B1', examine:'B1', discover:'B1', explore:'B1',
  estimate:'B1', calculate:'B1', consider:'B1', evaluate:'B1',
  determine:'B1', identify:'B1', indicate:'B1', justify:'B1',
  maintain:'B1', obtain:'B1', possess:'B1', recognize:'B1',

  aggressive:'B1', arrogant:'B1', cautious:'B1', corrupt:'B1',
  desperate:'B1', devoted:'B1', fierce:'B1', ruthless:'B1',
  treacherous:'B1', ambitious:'B1', reckless:'B1', relentless:'B1',
  stubborn:'B1', cunning:'B1', honorable:'B1', righteous:'B1',
  wicked:'B1', vicious:'B1', merciless:'B1',

  apparently:'B1', consequently:'B1', nevertheless:'B1', moreover:'B1',
  meanwhile:'B1', therefore:'B1', furthermore:'B1', however:'B1',
  gradually:'B1', eventually:'B1', desperately:'B1', fiercely:'B1',
  reluctantly:'B1', eagerly:'B1', instantly:'B1', barely:'B1',

  // ── B2 ─────────────────────────────────────────────────────────────────────
  sovereignty:'B2', hierarchy:'B2', authority:'B2', supremacy:'B2',
  covenant:'B2', chronicle:'B2', mythology:'B2', folklore:'B2',
  enchantment:'B2', sorcery:'B2', supernatural:'B2', mystical:'B2',
  alchemy:'B2', apparition:'B2', manifestation:'B2', incarnation:'B2',

  ambiguity:'B2', contradiction:'B2', paradox:'B2', dilemma:'B2',
  phenomenon:'B2', perspective:'B2', presumption:'B2', speculation:'B2',
  implication:'B2', correlation:'B2', distinction:'B2', interpretation:'B2',

  acknowledge:'B2', articulate:'B2', convey:'B2', depict:'B2',
  invoke:'B2', manifest:'B2', perceive:'B2', portray:'B2',
  provoke:'B2', reconcile:'B2', retrieve:'B2', transform:'B2',
  diminish:'B2', enhance:'B2', illuminate:'B2', obscure:'B2',

  profound:'B2', subtle:'B2', intricate:'B2', elaborate:'B2',
  relentless:'B2', ominous:'B2', sinister:'B2', formidable:'B2',
  inevitable:'B2', imminent:'B2', treacherous:'B2', perilous:'B2',
  ferocious:'B2', harrowing:'B2', excruciating:'B2', devastating:'B2',

  // ── C1 ─────────────────────────────────────────────────────────────────────
  arcane:'C1', esoteric:'C1', ethereal:'C1', elusive:'C1',
  clandestine:'C1', surreptitious:'C1', enigmatic:'C1', cryptic:'C1',
  labyrinthine:'C1', treacherous:'C1', insidious:'C1', malevolent:'C1',
  benevolent:'C1', omnipotent:'C1', omniscient:'C1', transcendent:'C1',
  ineffable:'C1', ephemeral:'C1', inexorable:'C1', irrevocable:'C1',

  elucidate:'C1', circumvent:'C1', perpetuate:'C1', exacerbate:'C1',
  mitigate:'C1', alleviate:'C1', exacerbate:'C1', ameliorate:'C1',
  corroborate:'C1', substantiate:'C1', invalidate:'C1', vindicate:'C1',

  // ── C2 ─────────────────────────────────────────────────────────────────────
  apotheosis:'C2', puissance:'C2', sempiternal:'C2', numinous:'C2',
  dauntless:'C2', implacable:'C2', inimitable:'C2', redoubtable:'C2',
};

// ── 最終補充批次（全書分析後仍缺漏的高頻詞） ────────────────────────────────
const finalBatch = {
  // A1 缺漏（suffix stripping 處理不到的常用詞）
  chapter:'A1', island:'A1', cross:'A1', couple:'A1', minute:'A1',
  hang:'A1', flow:'A1', flight:'A1', fully:'A1', further:'A1',
  mighty:'A2', somewhat:'B1', awaken:'B1', widen:'B1', extend:'B1',
  sheer:'B2', brute:'B2', slender:'B2', tremendous:'B1', torso:'B2',
  obsidian:'C1', magma:'C1', hematite:'C1',
  // 常見衍生形式
  tighten:'B1', widen:'B1', loosen:'B1', brighten:'A2', darken:'A2',
  soften:'A2', harden:'B1', deepen:'B1', strengthen:'B1', weaken:'B1',
  lengthen:'B1', shorten:'B1', heighten:'B1', worsened:'A2',
  slightly:'B1', mostly:'A2', mainly:'A2', partly:'B1', barely:'B1',
  deeply:'A2', widely:'A2', highly:'A2', closely:'B1', firmly:'B1',
  freely:'A2', fairly:'B1', nearly:'A2', merely:'B1', nearly:'A2',
  lately:'A2', lately:'A2', simply:'A2', solely:'B1', largely:'B1',
  fully:'A1', wholly:'B1', briefly:'B1', sharply:'B1', firmly:'B1',
  bravely:'A2', quickly:'A2', slowly:'A2', softly:'A2', loudly:'A2',
  calmly:'A2', gently:'A2', roughly:'A2', darkly:'A2', lightly:'A2',

  // 常見衍生名詞（不能 suffix strip 的）
  flight:'A2', sight:'A2', might:'B1', height:'A2', weight:'A2',
  length:'A2', strength:'B1', growth:'B1', death:'A1', wealth:'B1',
  health:'A1', stealth:'B2', warmth:'A2', depth:'B1', width:'B1',
  truth:'A1', youth:'A2', oath:'B1', wrath:'B2', filth:'B2',

  // A2
  shoot:'A2', gain:'A2', figure:'A2', throat:'A2', notion:'A2', bolt:'A2',
  demand:'A2', height:'A2', depth:'A2', speed:'A2', weight:'A2', length:'A2',
  task:'A2', habit:'A2', quality:'A2', value:'A2', coast:'A2', harbor:'A2',
  earn:'A2', risk:'A2', spread:'A2', beat:'A2', slam:'A2', smash:'A2',
  guess:'A2', wonder:'A2', hide:'A2', seek:'A2', scramble:'A2',
  level:'A2', stage:'A2', rate:'A2', manner:'A2', nature:'A2',
  reason:'A2', cause:'A2', effect:'A2', detail:'A2', aspect:'A2',

  // B1
  merchant:'B1', friar:'B1', knowing:'B1', dart:'B1', surge:'B1',
  mutter:'B1', wince:'B1', flinch:'B1', brood:'B1', ponder:'B1',
  feign:'B1', stammer:'B1', scheme:'B1', jaw:'B1', brow:'B1', cheek:'B1',
  wrist:'B1', elbow:'B1', ankle:'B1', heel:'B1', knuckle:'B1',
  robe:'B1', tunic:'B1', mantle:'B1', gauntlet:'B1',
  profit:'B1', benefit:'B1', yield:'B1', obligation:'B1',
  section:'B1', verse:'B1', port:'B1', dock:'B1', shore:'B1',

  // B2
  enigmatic:'B2', cryptic:'B2', stratagem:'B2', gambit:'B2', ruse:'B2',
  recluse:'B2', hermit:'B2', sage:'B2', oracle:'B2', ascetic:'B2',
};

// ── 合併（existing 優先；supplement 只填補缺漏） ──────────────────────────────
const merged = { ...finalBatch, ...supplement, ...existing };

// 統計
const levels = {};
for (const v of Object.values(merged)) {
  levels[v] = (levels[v] || 0) + 1;
}
console.log('Merged total:', Object.keys(merged).length);
console.log('Level distribution:', levels);

// 寫出
const outputPath = path.join(__dirname, '../src/data/cefr-wordlist.json');
fs.writeFileSync(outputPath, JSON.stringify(merged, null, 2), 'utf-8');
console.log('Written to', outputPath);
