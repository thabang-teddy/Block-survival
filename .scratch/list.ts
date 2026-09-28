import { recipesFor } from '../resources/js/items/recipes'
const bench = recipesFor('bench')
console.log(`bench shows ${bench.length} recipes, in this order (2-column grid, so row = index/2):\n`)
bench.forEach((r, i) => {
  const row = Math.floor(i / 2) + 1
  console.log(`  row ${String(row).padStart(2)}  ${r.id}`)
})
console.log('\nhand:', recipesFor('hand').map(r => r.id).join(', '))
