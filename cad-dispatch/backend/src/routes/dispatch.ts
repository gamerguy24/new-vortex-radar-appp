import { Router } from 'express';
import { getActiveCalls, getUnits, pushDispatchEvent } from '../services/dispatchService';
import { DispatchEventPayload } from '../types/dispatch';

export const dispatchRouter = Router();

dispatchRouter.get('/calls', (_req, res) => {
  res.json({ calls: getActiveCalls() });
});

dispatchRouter.get('/units', (_req, res) => {
  res.json({ units: getUnits() });
});

dispatchRouter.post('/events', (req, res) => {
  const payload = req.body as DispatchEventPayload;
  pushDispatchEvent(payload, (event) => {
    if (typeof globalThis.broadcastDispatch === 'function') {
      globalThis.broadcastDispatch(event);
    }
  });
  res.json({ accepted: true, payload });
});

dispatchRouter.post('/assign', (req, res) => {
  const { unitId, callId } = req.body;
  const call = getActiveCalls().find((entry) => entry.id === callId);
  if (!call) {
    return res.status(404).json({ error: 'Call not found' });
  }

  const unit = getUnits().find((entry) => entry.id === unitId);
  if (!unit) {
    return res.status(404).json({ error: 'Unit not found' });
  }

  call.assignedUnit = unit.badge;
  pushDispatchEvent({
    type: 'UnitAssigned',
    timestamp: new Date().toISOString(),
    data: { unitId, callId, badge: unit.badge, code: 'ASSIGNED' },
  }, (event) => {
    if (typeof globalThis.broadcastDispatch === 'function') {
      globalThis.broadcastDispatch(event);
    }
  });

  return res.json({ call, unit });
});
