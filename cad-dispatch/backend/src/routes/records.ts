import { Router } from 'express';

export const recordsRouter = Router();

const records = {
  civilians: [
    { id: 'CIV-001', name: 'Jordan Reyes', status: 'Clear', notes: 'No prior warrants.' },
    { id: 'CIV-002', name: 'Tessa Green', status: 'Watchlist', notes: 'Known vehicle theft suspect.' },
  ],
  vehicles: [
    { id: 'VEH-001', plate: 'CAD-271', owner: 'Jordan Reyes', status: 'Verified', color: 'Silver' },
  ],
  warrants: [
    { id: 'WAR-010', subject: 'Tessa Green', offense: 'Possession of stolen vehicle', active: true },
  ],
  bolos: [
    { id: 'BOLO-001', description: 'Blue sedan, reported in pursuit near Downtown', active: true },
  ],
};

recordsRouter.get('/civilian', (_req, res) => {
  res.json(records.civilians);
});

recordsRouter.get('/vehicles', (_req, res) => {
  res.json(records.vehicles);
});

recordsRouter.get('/warrants', (_req, res) => {
  res.json(records.warrants);
});

recordsRouter.get('/bolos', (_req, res) => {
  res.json(records.bolos);
});
