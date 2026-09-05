// src/voice/commonWords.ts

// Everyday English words that the phonetic matcher refuses to treat as a
// mishearing. Double Metaphone collapses vowels and voiced/unvoiced consonant
// pairs, so without this veto a "yeet" trigger fires on "yet", "drip" fires on
// "drop", and "swag" fires on "sick", "sock", "sack", "seek" and "soak" - all
// measured, not hypothetical. A word here can still fire a trigger by being
// spelled out exactly in the config; it is only barred from matching by sound.

/** Words the phonetic tier will not accept as a mishearing of a trigger. */
export const COMMON_WORDS: ReadonlySet<string> = new Set(
  `a about above across act add after again against age ago agree air all allow almost alone along
already also although always am among amount an and anger angry animal another answer any anyone
anything appear apply area argue arm around arrive art as ask at attack attempt away baby back bad
bag ball bank bar base bass baste be bear beat beautiful beauty because become bed been before
begin behind believe below best better between beyond big bill bird bit bite black blood blow blue
board boat body book boost boot born both bottle bottom box boy break bring brother build burn bus
business bust busy but buy by call can car card care carry case cast catch cause cell center century
certain chair chance change charge check child choice choose church city claim class clean clear
close coast coat cold college colour come common community company compare complete computer
condition consider contain continue control cook copy corner cost could country couple course cover
create cross cry cup cut dark date daughter day dead deal dear death decide deep degree describe
design desk detail develop die difference different difficult dinner direct discover discuss do
doctor dog door doubt down draw dream dress drink drive drop dry due during each ear early earth
ease east easy eat edge education effect effort egg eight either else end enemy energy enjoy enough
enter equal escape even evening event ever every exact example except exist expect experience
explain eye face fact fail fair fall family famous far farm fast father fear feed feel few field
fight figure fill film final find fine finger finish fire first fish fit five fix floor flow flower
fly follow food foot for force forest forget form former forward four free fresh friend from front
full fun function further future game garden gas gate general get gift girl give glass go god gold
good govern great green ground group grow guard guess guest guide gun guy hair half hall hand hang
happen happy hard has hat hate have he head health hear heart heat heavy help her here herself hide
high hill him himself his history hit hold hole holiday home hope horse hospital hot hotel hour
house how however huge human hundred hunt hurt i ice idea if ill imagine important improve in
include increase indeed industry inside instead interest into introduce is island issue it its
itself job join joy judge jump just keep key kick kid kill kind king kitchen knee know lack lady
lake land language large last late laugh law lay lead learn least leave left leg less let letter
level lie life lift light like line lip list listen little live local lock long look lose loss lost
lot loud love low luck lunch machine main major make man many map mark market marry mass master
match matter may maybe me mean measure meat media meet member memory mention mess message method
middle might mile milk mind mine minute miss mistake mix model modern moment money month moon more
morning most mother mountain mouth move movie much music must my myself name nation natural nature
near necessary neck need never new news next nice night nine no none nor north nose not note nothing
notice now number obtain occur ocean of off offer office often oil old on once one only open
opinion or order other ought our out outside over own page pain paint pair paper parent park part
party pass past paste path pause pay peace people perfect perhaps period person phone pick picture
piece place plan plant play please point police policy political poor popular position possible
post pound power practice prepare present press pretty prevent price print private probably problem
produce program project property protect provide public pull purpose push put quality question
quick quiet quite race radio rain raise range rate rather reach read ready real reason receive
record red reduce refer regard region relate remain remember remove repeat report require research
respond rest result return rich ride right ring rise risk river road rock role roll room round rule
run safe sail sale salt same sand save say scene school science sea search season seat second
secret section see seek seem sell send sense separate serious serve service set seven several
shake shall shape share sharp she ship shoe shoot shop short should shoulder shout show sick side
sight sign similar simple since sing single sink sir sister sit site situation six size skill skin
sky sleep slow small smell smile smoke snow so soak social sock soft soil soldier some son song
soon sorry sort sound source south space speak special speed spend spirit sport spot spread spring
staff stage stair stand star start state station stay step stick still stock stone stop store storm
story straight strange street strong student study stuff style subject success such sudden suffer
sugar suggest summer sun supply support suppose sure surface surprise sweat sweep sweet swim system
table take talk tall taste tax teach team tear tell ten term test than thank that the their them
then there these they thick thin thing think third this those though thought three through throw
thus tie time tiny tip tire title to today together tone tonight too took tool top total touch
toward town trade train travel treat tree trip trouble true trust truth try turn twenty two type
under understand union unit until up upon us use usual value various very view village visit voice
vote wait walk wall want war warm wash waste watch water wave way we wear weather week weight
welcome well west what wheel when where whether which while white who whole whom whose why wide
wife wild will win wind window wine wing winter wire wise wish with within without woman wonder
wood word work world worry worth would write wrong yard year yes yet you young your yourself youth`
    .split(/\s+/)
    .filter(Boolean),
);
