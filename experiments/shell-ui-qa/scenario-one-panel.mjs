// Only one of Bookmarks, The Olds, Knowledge and My map is open at a time.
export default async function ({ evaluate, shotApp: shot, delay }) {
  await delay(5000)
  const state = () => evaluate(`JSON.stringify({ bookmarks: !!document.querySelector('.bookmark-pane'), olds: !!document.querySelector('.olds-sheet'), knowledge: !!document.querySelector('.knowledge-sheet'), mymap: !!document.querySelector('.bookmark-drawer') })`)
  const press = (label) => evaluate(`[...document.querySelectorAll('.bookmark-library-button')].find((b) => b.innerText.includes(${JSON.stringify(label)}))?.click(); true`)
  for (const label of ['Bookmarks', 'My map', 'Knowledge', 'The Olds', 'Bookmarks', 'Knowledge', 'My map']) {
    await press(label)
    await delay(1600)
    console.log(label.padEnd(10), '→', await state())
  }
  console.log('my map inside window:', await evaluate(`(() => { const r = document.querySelector('.bookmark-drawer')?.getBoundingClientRect(); return r ? (r.left >= 0 && r.right <= innerWidth) + ' left=' + Math.round(r.left) + ' right=' + Math.round(r.right) : 'closed' })()`))
  await shot('op1-mymap')
}
