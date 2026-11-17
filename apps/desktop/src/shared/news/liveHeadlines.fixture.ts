import type { NewsItemInput, NewsSourceMeta } from './newsDigest'

/**
 * Real headlines from the app's feeds on 17 November 2026 (found by the round 5 data audit), as
 * [country or 'intl' for an international desk, language, outlet, headline]. Each list is what a
 * search of that day's headlines for one story or one name returned, wrong ones included: the tests
 * say which belong together.
 */
export type LiveRow = [string, string, string, string]

/** Where the international desks in these rows are based. */
const DESKS: Record<string, string> = { dw: 'DE', france24: 'FR', rfi: 'FR', sbs: 'AU', africanews: 'CG', npr: 'US', nyt: 'US', aljazeera: 'QA', 'folha-mundo': 'BR', 'globo-mundo': 'BR', 'infobae-america': 'AR', scmp: 'HK', japantimes: 'JP', cna: 'SG' }

/** Feeds and items for rows, as the news service would hand them to a builder. */
export function live(rows: LiveRow[], now: number): { sources: NewsSourceMeta[]; items: NewsItemInput[] } {
  const sources = new Map<string, NewsSourceMeta>()
  const items = rows.map(([where, language, outlet, title], i): NewsItemInput => {
    const sourceId = `${where}-${outlet}-${language}`
    if (!sources.has(sourceId)) sources.set(sourceId, { sourceId, countryCode: where === 'intl' ? DESKS[outlet] ?? 'GB' : where, publisherName: outlet, publisherGroupId: outlet, scope: where === 'intl' ? 'international' : 'national', language })
    const at = new Date(now - (1 + (i % 6)) * 3_600_000).toISOString()
    return { sourceId, title, url: `https://${outlet}.example/${i}-${encodeURIComponent(title).slice(0, 60)}`, publishedAt: at, discoveredAt: at }
  })
  return { sources: [...sources.values()], items }
}

export const RWANDA_DEPORTATION: LiveRow[] = [
  ['intl', 'en', 'bbc', 'Five EU countries announce migrant deportation centre in Rwanda'],
  ['intl', 'es', 'france24', 'Informe desde Bruselas: cinco países europeos planean crear centro de deportación en Ruanda'],
  ['AO', 'pt', 'correio-kianda', 'Cinco países europeus preparam centro de repatriamento de migrantes africanos no Ruanda'],
  ['EE', 'et', 'postimees-grupp', 'Viis ELi riiki plaanivad rajada Rwandasse migrantide väljasaatmiskeskuse'],
  ['PL', 'pl', 'gremi-media', 'Rwanda przyjmie nielegalnych imigrantów z UE. Powstanie pierwszy taki ośrodek'],
  ['RO', 'ro', 'hotnews', 'Schema de deportare în Rwanda a solicitanților de azil respinși: Cele 5 țări europene și-au dezvăluit planul'],
  ['UZ', 'uz', 'kun-uz', 'Yevropa Ittifoqi Ruandada migrantlar uçun markaz taşkil etiş rejasini taqdim etdi'],
  ['FR', 'fr', 'ebra', 'Union européenne. Comment cinq pays, dont l\'Allemagne, vont expulser des migrants vers le Rwanda'],
  ['ES', 'ca', 'apunt', 'Cinc països europeus impulsaran a Ruanda el primer centre de retorn per a sol·licitants d’asil rebutjats a la UE'],
  ['IT', 'it', 'citynews', 'Caro Bignami, un hub migranti in Ruanda val bene un "Avanti Giorgia"?'],
  ['intl', 'en', 'dw', 'Germany joins 4 other EU states to set up Rwanda deportation hub'],
  ['MX', 'es', 'el-universal-mx', 'Polémica en Europa; cinco países presentan plan para crear en Ruanda un centro para migrantes expulsados'],
  ['BR', 'pt', 'grupo-globo', 'Países da Europa negociam criação de centro de deportação de imigrantes ilegais em Ruanda'],
  ['RO', 'ro', 'jurnaluldearges', 'Decizie majoră privind migranții în Europa: Cinci țări UE vor să îi trimită în Rwanda, iar primele deportări ar putea începe în 2027'],
  ['LU', 'fr', 'mediahuis-lu', 'Cinq pays européens, dont l’Allemagne et les Pays-Bas, vont envoyer des migrants au Rwanda'],
  ['ES', 'ca', 'ara', 'Cinc països de la UE crearan un centre de deportació de migrants a Ruanda'],
  ['intl', 'en', 'aljazeera', 'Five EU countries announce plan to send rejected asylum seekers to Rwanda'],
  ['intl', 'en', 'nyt', 'Five European Countries Plan to Deport Migrants to Rwanda'],
  ['intl', 'en', 'scmp', 'Five EU countries unveil plans for Rwanda deportation hub'],
  ['intl', 'en', 'cna', 'EU nations unveil Rwanda deal for migrant return hub'],
  ['RW', 'en', 'kt-press', 'Rwanda to Retain Full Control Over EU Migrants It Receives'],
]

export const FRANCOPHONIE: LiveRow[] = [
  ['intl', 'fr', 'france24', 'La Francophonie en crise ?'],
  ['intl', 'en', 'rfi', 'Francophonie summit delays secretary-general vote after Rwanda-DRC deadlock'],
  ['RW', 'rw', 'kigali-today', 'Ibibazo bya Dipolomasi, izingiro mu isubikwa ry\'amatora y\'Umunyamabanga Mukuru wa Francophonie'],
  ['BJ', 'fr', '24h-au-benin', 'Voici les conclusions du 20e sommet de la Francophonie'],
  ['intl', 'en', 'africanews', 'DR Congo-Rwanda tensions force Francophonie leadership election delay until 2027'],
  ['CD', 'fr', 'actualite-cd', '20e sommet de la Francophonie: le Rwanda absent de la résolution sur la crise sécuritaire dans l’Est de la RDC'],
  ['RW', 'en', 'kt-press', 'Francophonie: DRC President Walks Out of Summit, Disapppointment in Rwanda – Senegal Solves Impasse'],
  ['CG', 'fr', 'journal-de-brazza', 'Francophonie : le Congo défend trois priorités à Phnom Penh'],
  ['RW', 'en', 'taarifa', 'Francophonie Countries Challenged to Build Their Own AI, Digital Technologies'],
]

export const ESTADOS_UNIDOS: LiveRow[] = [
  ['intl', 'pt', 'folha-mundo', 'Presidente do Equador nega que o país tenha uma base militar dos Estados Unidos'],
  ['intl', 'es', 'infobae-america', 'Casillero virtual en Miami: llega a Colombia una alternativa para comprar en Estados Unidos y recibir pedidos en casa'],
  ['US', 'en', 'calmatters', 'La Corte Suprema de Estados Unidos rechaza el intento de Trump de imponer políticas de DEI a los investigadores de la UC'],
  ['BR', 'pt', 'globo', 'Estados Unidos vão limitar uso de chips americanos em data centers do Brasil e de outros quatro países'],
  ['CR', 'es', 'grupo-nacion', 'Estados Unidos bloquea el acceso indirecto de China a chips de IA estadounidenses'],
  ['US', 'en', 'us-times-of-san-diego', 'El USS Theodore Roosevelt llega a Oriente Medio y ahora Estados Unidos tiene tres portaaviones en la región'],
  ['PA', 'es', 'corprensa', 'Trump atribuye la paralización aérea en Estados Unidos a ‘equipos extremadamente antiguos’'],
  ['UY', 'es', 'la-diaria', 'Caso Marset: Fiscalía de Estados Unidos habló con el fiscal Diego Pérez por el atentado a la Brigada Antinarcóticos'],
  ['AR', 'es', 'la-nacion-ar', 'La nueva regla del SNAP que se debe acatar en todo Estados Unidos y se podría aplicar a inmigrantes'],
  ['MX', 'es', 'la-jornada', 'Manuel Pérez Rocha L.*: Estados Unidos y su necesitada T'],
  ['PA', 'es', 'tvn-media', 'Selecciones femeninas de Panamá y Estados Unidos se probarán en amistoso a inicios de 2027'],
  ['PR', 'es', 'gfr-media', 'Los retos de un nuevo paradigma político en Estados Unidos'],
]

export const BANK_OUTAGE: LiveRow[] = [
  ['intl', 'pt', 'globo-mundo', 'Falha técnica afeta serviços de grandes bancos dos Estados Unidos'],
  ['DO', 'es', 'diario-libre', 'Fallas en bancos de EE.UU. impiden acceso a cuentas'],
  ['AR', 'es', 'la-nacion-ar', 'Reportan fallas en los principales bancos de Estados Unidos: miles de usuarios denuncian problemas para operar'],
  ['PR', 'es', 'gfr-media', 'Problema técnico en JPMorgan Chase provoca fallas de banca en línea en varios bancos de EE.UU.'],
  ['EC', 'es', 'primicias', 'Estados Unidos | Clientes de grandes bancos, como Chase o Bank of America, reportan problemas para acceder a sus cuentas'],
  ['BO', 'es', 'bo-eldiario', 'Fallas bancarias afectan a miles de usuarios en Estados Unidos (19:05)'],
  ['PR', 'es', 'metro-pr', 'Fallas en servicios bancarios afectan a clientes de importantes bancos en Estados Unidos'],
  ['DO', 'es', 'el-nacional-do', 'Falla en bancos EEUU congela transferencias y golpea a Bank of America y Wells Fargo'],
]

export const SOUTH_AFRICA_SHOOTINGS: LiveRow[] = [
  ['intl', 'en', 'bbc', 'Two mass shootings in South Africa leave 17 dead'],
  ['intl', 'en', 'dw', 'South Africa: 17 killed in separate mass shooting incidents'],
  ['intl', 'en', 'africanews', 'South Africa reels from deadly mass shootings as residents demand arrests'],
  ['BS', 'en', 'cable-bahamas', 'At Least 17 People Killed In 2 Mass Shootings On Sunday in South Africa'],
  ['NG', 'en', 'media-trust', 'South Africa: 17 killed in 2 mass shootings'],
  ['BH', 'en', 'daily-tribune-bh', '17 Killed in Two South Africa Mass Shootings'],
  ['NG', 'en', 'premium-times', '17 killed in separate South African mass shootings'],
  ['KW', 'en', 'al-seyassah', 'At least 17 killed in separate shootings in South Africa'],
]

export const SOUTH_KOREA: LiveRow[] = [
  ['intl', 'en', 'nyt', 'South Korea to Examine How K-Pop Industry Treats Underage Performers'],
  ['PH', 'en', 'gma-network', 'Philippines eyes more Filipino products in South Korea amid trade talks'],
  ['AF', 'en', 'ariana-news', 'South Korea to inspect glasses worn by exam candidates after AI cheating scandal'],
  ['BH', 'en', 'daily-tribune-bh', 'South Korea Reaffirms Generational Economic Commitment to Bahrain'],
  ['LK', 'en', 'echelon-media', 'South Korea, Sri Lanka discuss ageing populations, investment'],
  ['AF', 'en', 'khaama', 'South Korea’s Top Tax Exam Scorer Admits Cheating With AI'],
  ['NP', 'en', 'nepal-republic-media', 'South Korea earns $70.35 billion from ICT exports in October, driven by AI chip demand'],
  ['US', 'en', 'nexstar', 'South Korea-based bakery café Tous les Jours opens in Powell'],
]

export const BLACK_FRIDAY: LiveRow[] = [
  ['CO', 'es', 'casa-editorial-el-tiempo', 'Black Friday: cinco preguntas que debería hacerse antes de comprar'],
  ['IE', 'en', 'rte', 'Nearly 73% do not trust Black Friday prices, survey finds'],
  ['UA', 'uk', 'unian-1plus1', 'Black Friday: як вигідно придбати техніку та не пропустити потрібну модель'],
  ['BR', 'pt', 'cidade-verde', 'Fim das bets pode impulsionar vendas no comércio do Piauí durante Black Friday'],
  ['AT', 'de', 'orf', 'AK warnt vor Black Friday-Angeboten'],
  ['RO', 'ro', 'svnews', '„Black Friday” și pentru artă! Un Adrian Ghenie, de la 8.000 de Euro!'],
  ['PY', 'es', 'py-laclave', 'QUIMFA y Farmacia Triunfo fortalecen su alianza con una propuesta especial para el Black Friday'],
  ['US', 'en', 'nbcuniversal', 'The 41+ best early Black Friday deals, handpicked by a shopping expert'],
  ['BR', 'pt', 'globo', 'Em ritmo de Black Friday, Geap lança dia 19 campanha com oferta exclusiva'],
  ['ES', 'es', 'joly', 'El comercio de barrio en Cádiz desafía al Black Friday: "Es una campaña movida por el precio; hay que sopesar si merece la pena lo que se compra"'],
  ['US', 'en', 'advance', 'KitchenAid stand mixer drops to $279 ahead of Black Friday'],
  ['BR', 'pt', 'o-imparcial', 'Black Friday 2026: lojas físicas lideram intenção de compra em São Luís, mas internet domina a pesquisa de preços'],
]

export const SANTA_CRUZ: LiveRow[] = [
  ['MO', 'pt', 'jornal-tribuna-de-macau', 'Justiça continua por concretizar 35 anos após massacre do cemitério de Santa Cruz'],
  ['CL', 'es', 'cl-elrancaguino', 'Santa Cruz: Condenan a siete años de presidio a autor de robo con intimidación'],
  ['US', 'en', 'nexstar', 'Santa Cruz County tornado warning in effect for Davenport'],
  ['ES', 'es', 'elespanol', 'Discordia en el pleno del Ayuntamiento de Santa Cruz de Tenerife para aprobar los 388 millones de presupuesto para 2027'],
  ['US', 'en', 'nbcuniversal', 'Bay Area storm: Santa Cruz County tornado warning, twin waterspouts spotted in SF'],
  ['ES', 'es', 'eldiario', 'Santa Cruz de Tenerife aprueba un presupuesto récord con aumento en propaganda y recortes en vivienda'],
  ['MX', 'es', 'quadratin', 'Rescatan a 2 surfistas de olas peligrosas en Santa Cruz'],
]

export const LUKAKU: LiveRow[] = [
  ['intl', 'en', 'japantimes', 'Belgium’s Lukaku retires from international football'],
  ['CR', 'es', 'grupo-nacion', 'Romelu Lukaku, máximo goleador de Bélgica, pone fin a su carrera internacional'],
  ['AZ', 'az', 'report-az', 'Romelu Lukaku Belçika millisindəki karyerasını başa vurub'],
  ['BJ', 'fr', 'benin-web-tv', 'Belgique : Romelu Lukaku prend sa retraite internationale avec 94 buts en 135 sélections'],
  ['BE', 'nl', 'vrt', '"Het niveau van Romelu halen? Neen, nooit": inwoners van Wintam reageren op vertrek van Lukaku bij Rode Duivels'],
  ['ID', 'id', 'antara', 'Romelu Lukaku pensiun bela timnas Belgia'],
  ['NG', 'en', 'lagos-television', 'Romelu Lukaku retires from international football after 16 years'],
  ['PA', 'es', 'corprensa', 'Romelu Lukaku se retira de la selección de Bélgica'],
  ['TN', 'fr', 'mosaique-fm', 'Belgique : Romelu Lukaku dit adieu aux Diables Rouges'],
  ['BE', 'nl', 'bruzz', 'Romelu Lukaku stopt bij de Rode Duivels'],
]

export const TRUMP_BIDEN: LiveRow[] = [
  ['MU', 'fr', 'defi-media-group', 'Paralysie du trafic aérien aux États-Unis : Trump accuse l’administration Biden et réclame davantage de financements'],
  ['PT', 'pt', 'diariocoimbra', 'Trump culpa administração Biden por falha nos sistemas de aviação'],
  ['ES', 'es', 'atlantico', 'Trump culpa a Biden del caos aéreo y reclama más fondos'],
  ['US', 'en', 'us-inquirer', 'Trump bristles at criticism over grounding of planes, blaming old tech and Biden for the problems'],
  ['IN', 'en', 'mathrubhumi', 'Trump blames Biden for US flight disruption, refuses responsibility for nationwide ground stop'],
  ['US', 'en', 'graham', 'Trump clipped Biden\'s payouts for stranded travelers. It may not have helped during the ground stop'],
  ['US', 'en', 'us-mpr-news', 'Trump attributes nationwide grounding of planes to old technology, Biden administration'],
]

export const TRUMP_SUMMIT: LiveRow[] = [
  ['intl', 'en', 'dw', 'China says Xi, Trump, Putin to discuss \'world peace\''],
  ['intl', 'es', 'france24', 'Encuentro Trump-Xi-Putin: la errónea comparación con la conferencia de Yalta'],
  ['VA', 'it', 'vaticannews', 'Cina, confermato il vertice tra Xi Jinping, Trump e Putin a Shenzhen'],
  ['HR', 'hr', 'index-hr', 'Božo Kovačević: Trump, Putin i Xi moraju smisliti kako odgoditi Treći svjetski rat'],
  ['LT', 'lt', 'lrt', 'Kremlius: sunku pervertinti Trumpo, Putino ir Xi Jinpingo susitikimo svarbą'],
  ['FI', 'sv', 'ksf', 'Bekräftat: Trump, Xi och Putin möts i veckan'],
  ['TR', 'tr', 'bursahakimiyet', 'Trump\'tan dünya gündemini sarsacak açıklama! Xi ve Putin ile görüşecek, Kim Jong Un sürprizi'],
  ['RO', 'ro', 'monitorulcj', 'China confirmă întâlnirea dintre Trump, Xi Jinping și Putin: Războiul din Ucraina nu se regăsește pe agenda summitului de la Shenzhen'],
  ['intl', 'en', 'npr', 'FAA ground stop still affecting thousands of flights. And, Trump meets Xi, Putin in Asia'],
  ['CR', 'es', 'grupo-nacion', 'Xi, Trump y Putin hablarán de la ‘paz mundial’ en su cumbre trilateral'],
  ['HK', 'en', 'hkfp', 'China says Xi, Trump, Putin to discuss ‘world peace’ at Shenzhen summit'],
  ['DO', 'es', 'diario-libre', 'China dice que Xi, Trump y Putin hablarán de "paz mundial" en cumbre'],
]

export const GERMANY_NETHERLANDS: LiveRow[] = [
  ['intl', 'en', 'dw', 'Germany beat Netherlands 5-0 to win Nations League group'],
  ['CR', 'es', 'grupo-nacion', 'Alemania arrolla a Países Bajos para sellar clasificación en la Nations League de Europa'],
  ['ID', 'id', 'antara', 'Hancurkan Belanda 5-0, Jerman ke perempat final sebagai juara grup'],
  ['BJ', 'fr', 'benin-web-tv', 'Ligue des nations : l’Allemagne écrase les Pays-Bas 5-0, la Grèce éliminée'],
  ['DE', 'de', 'madsack', 'DFB-Elf erreicht Viertelfinale der Nations League: 5:0-Gala gegen die Niederlande'],
  ['intl', 'en', 'aljazeera', 'Germany thrash Netherlands to book quarterfinal spot'],
  ['MX', 'es', 'el-universal-mx', 'Alemania destroza a Países Bajos; aseguran su pase a cuartos de final de la UEFA Nations League'],
  ['ID', 'id', 'suara-surabaya', 'Jerman Lolos ke Perempat Final Nations League Usai Libas Belanda 5-0'],
  ['LU', 'fr', 'mediahuis-lu', 'Cinq pays européens, dont l’Allemagne et les Pays-Bas, vont envoyer des migrants au Rwanda'],
  ['DE', 'de', 'funke', 'Deutschland gegen Niederlande in Berlin: Oranje-Fans ziehen zum Olympiastadion'],
]

export const BOND: LiveRow[] = [
  ['intl', 'en', 'dw', 'British actor Robert Pattinson confirmed as new James Bond'],
  ['intl', 'fr', 'france24', 'L\'acteur britannique Robert Pattinson devient le nouveau James Bond'],
  ['CR', 'es', 'grupo-nacion', 'Robert Pattinson será el nuevo James Bond: actor británico asumirá el papel del agente 007'],
  ['FO', 'fo', 'kvf', 'Nýggjur James Bond-filmur á skránni'],
  ['ID', 'id', 'antara', 'Robert Pattinson: James Bond adalah kehormatan seumur hidup'],
  ['SI', 'sl', 'delo', 'Znano je, kdo bo novi James Bond'],
  ['BA', 'bs', 'united-media-n1', 'Poznato ko je novi James Bond'],
  ['BE', 'nl', 'vrt', 'De nieuwe James Bond is bekend: Robert Pattinson (40) neemt rol over van Daniel Craig (58)'],
  ['CZ', 'cs', 'vltava-labe-media', 'James Bond má novou tvář. Daniela Craiga střídá Robert Pattinson'],
  ['NO', 'nb', 'polaris', 'Robert Pattinson får rollen som James Bond'],
  ['PT', 'pt', 'diariocoimbra', 'Robert Pattinson vai interpretar James Bond no filme de Denis Villeneuve'],
  ['DE', 'de', 'radiobremen', 'Was Bremerinnen und Bremer zum neuen James Bond sagen'],
  ['ES', 'ca', 'ara', 'Robert Pattinson serà el nou James Bond'],
  ['TR', 'tr', 'olay', 'Yeni James Bond belli oldu'],
  ['RO', 'ro', 'gds', 'Robert Pattinson, ales să fie noul James Bond. Actorul îi succede lui Daniel Craig în rolul agentului 007'],
  ['intl', 'en', 'sbs', '\'A dream come true\': The next James Bond has been revealed'],
  ['BJ', 'fr', 'benin-web-tv', 'James Bond : Robert Pattinson devient le septième 007 de la saga'],
  ['DO', 'es', 'diario-libre', 'La elección de Robert Pattinson como James Bond divide opiniones'],
]

export const TRUMP_ELSEWHERE: LiveRow[] = [
  ['intl', 'pt', 'folha-mundo', 'Vitória dos democratas nas eleições foi uma estaca no coração de Trump'],
  ['intl', 'en', 'scmp', 'Trump appeals to state and federal courts to erase hush money conviction'],
  ['BO', 'es', 'opinion-bo', 'Trump propone a Kara Frederick como embajadora de EEUU en Bolivia'],
  ['TR', 'tr', 'anadolu-ajansi', 'Rusya: Trump\'ın Ukrayna\'da daha sert davranabileceğimiz yönündeki görüşüne katılıyoruz'],
  ['NO', 'nb', 'schibsted', 'Gjorde narr av Trump-forslag: – Hånlig og spydig'],
  ['SO', 'so', 'allbanaadir', 'Trump oo sheegay inuu Shiinaha kula kulmayo Kim Jong Un'],
]

export const ESTONIA_BORDER: LiveRow[] = [
  ['intl', 'en', 'bbc', 'Estonia to close Russia border crossings after attempted drone factory arson attack'],
  ['intl', 'fr', 'france24', 'L\'Estonie ferme sa frontière avec la Russie'],
  ['EE', 'et', 'err', 'Taro: Eesti ja Venemaa vahelise piiri sulgemise tõttu tuleb vedajatel oma elu ümber korraldada'],
  ['RO', 'ro', 'gds', 'Estonia își va închide frontiera cu Rusia'],
  ['ID', 'id', 'antara', 'Estonia tutup perbatasan Rusia mulai 1 Desember imbas dugaan sabotase drone'],
  ['intl', 'en', 'sbs', '‘Actions have consequences’: Why Estonia is shutting its last border crossings to Russia'],
  ['FR', 'fr', 'ladepeche', 'L’Estonie ferme sa frontière avec la Russie dès le 1er décembre : les renseignements russes accusés d’une opération de sabotage'],
]
