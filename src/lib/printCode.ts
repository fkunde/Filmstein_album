import { randomInt } from 'node:crypto'

import { supabase } from '@/lib/supabase/server'

function buildCandidate() {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  return `${letters[randomInt(letters.length)]}${letters[randomInt(letters.length)]}${String(randomInt(10000)).padStart(4, '0')}`
}

export async function generateUniquePrintCode() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidate = buildCandidate()
    const { data, error } = await supabase
      .from('photos')
      .select('global_photo_id')
      .eq('print_code', candidate)
      .maybeSingle()

    if (error) throw error
    if (!data) return candidate
  }

  throw new Error('Could not generate a unique print code')
}
