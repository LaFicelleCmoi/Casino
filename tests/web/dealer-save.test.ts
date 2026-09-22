import { describe, expect, it } from 'vitest';
import { DEFAULT_HOUSE, EMPTY_SERVICE } from '../../web/blackjack-house.js';
import { DEFAULT_BOT_NAMES, EMPTY_DEALER_SAVE, parseDealerSave, uniqueNames } from '../../web/dealer-save.js';

describe('sauvegarde du poste de croupier', () => {
  it('relit une sauvegarde complète telle quelle', () => {
    const save = {
      house: { ...DEFAULT_HOUSE, payout: '6:5', perfectPairs: true },
      jar: 42,
      service: { ...EMPTY_SERVICE, rounds: 7, tips: 42, bankNet: -120, theo: 3.5, deals: 7, seatsFilled: 50 },
      lifetimeTips: 1234,
      botNames: ['Gégé', ...DEFAULT_BOT_NAMES.slice(1)],
    };
    expect(parseDealerSave(JSON.parse(JSON.stringify(save)))).toEqual(save);
  });

  it('ne perd que le champ abîmé', () => {
    const save = parseDealerSave({ house: { payout: '2:1' }, jar: -5, service: { rounds: 'x' }, lifetimeTips: 300, botNames: 'Léa' });
    expect(save).toEqual({ ...EMPTY_DEALER_SAVE, lifetimeTips: 300 });
    expect(parseDealerSave(null)).toBe(EMPTY_DEALER_SAVE);
  });

  it('nettoie les noms de bots et retire les doublons', () => {
    const save = parseDealerSave({ botNames: ['  Gégé   le   bot ', 'gégé le bot', 42, 'Un nom beaucoup trop long pour la table'] });
    expect(save.botNames).toEqual(['Gégé le bot', 'Un nom beaucoup ']);
    expect(parseDealerSave({ botNames: [] }).botNames).toBe(DEFAULT_BOT_NAMES);
    expect(uniqueNames(['Léa', 'LÉA', 'Hugo'])).toEqual(['Léa', 'Hugo']);
  });
});
