import { describe, expect, it } from 'vitest'
import { detectFromText, detectHeadline, headlineLanguage } from './detect'

describe('headline language', () => {
  it('tells languages apart in a single headline', () => {
    expect(detectHeadline('Ukraina chce rozmów z Rosją i USA, zanim dojdzie do spotkania Putin-Trump-Xi')).toBe('pl')
    expect(detectHeadline('Espagne : plus de 46 morts dans une collision entre deux trains à grande vitesse')).toBe('fr')
    expect(detectHeadline('Aerolínea británica amplía sus vuelos entre Costa Rica y Londres')).toBe('es')
    expect(detectHeadline('Норвегия и Финляндия провели переговоры с Путиным')).toBe('ru')
    // Too few common words to call: "can't tell", never a wrong foreign language.
    expect(['en', null]).toContain(detectHeadline('Norway, Finland’s leaders hold rare talks with Putin'))
    expect(detectHeadline('Trump says the deal will be signed after the talks')).toBe('en')
  })
  it('keeps a feed’s language unless the headline plainly says otherwise', () => {
    expect(headlineLanguage(null, 'Ukraina chce rozmów z Rosją i USA')).toBe('pl')
    expect(headlineLanguage('en', 'Ukraina chce rozmów z Rosją i USA')).toBe('pl')
    // A cedilla ş is written by Romanian sites too: it does not make a Romanian feed's headline Turkish.
    expect(headlineLanguage('ro', 'Actorul Patrick Stewart, protagonist al francizelor X-Men şi Star Trek, a murit')).toBe('ro')
    expect(headlineLanguage('tr', 'Beşiktaş yeni sezona hazır')).toBe('tr')
    expect(headlineLanguage('ro', 'Galatasaray kazandı, ışıklar söndü')).toBe('tr')
    // å is Swedish too: a Swedish feed's headline stays Swedish.
    expect(headlineLanguage('sv', 'Stillastående personbil ger stopp i ett körfält på E4')).toBe('sv')
    expect(headlineLanguage('nb', 'Solskjær ut mot ryktene: – Bare tull')).toBe('nb')
    expect(headlineLanguage('es', 'Bolsonaro')).toBe('es')
    expect(headlineLanguage('pt', 'Lula vence eleição')).toBe('pt')
  })
})

describe('Faroese is not Icelandic', () => {
  it('tells them apart on a page and in a headline', () => {
    const faroese = 'Nú gott og væl 80 prosent av atkvøðunum eru tald upp eftir tjóðartingsvalið í Ísrael í gjár, eru Benjamin Netanyahu, forsætisráðharri í Ísrael, og hansara politisku stuðlar framvegis á odda. Sambært ísraelskum miðlum stendur samgongan hjá Netanyahu til at fáa 54 av teimum 120 sessunum.'
    expect(detectFromText(faroese)).toBe('fo')
    expect(detectHeadline('Samgongan hjá Netanyahu stendur til at fáa 54 sessir í tjóðartinginum')).toBe('fo')
    expect(detectFromText('Það er ekki gott að segja hvað gerist næst í kosningunum á Íslandi, en flokkarnir eru að ræða saman um stjórn.')).toBe('is')
  })
})
