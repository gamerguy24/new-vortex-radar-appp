import { pool } from '../db/pool';
import { Department, DispatchEventPayload, EmergencyCall, UnitStatus } from '../types/dispatch';

const activeCalls: EmergencyCall[] = [
  {
    id: 'CALL-1001',
    priority: 'Emergency',
    department: 'Police',
    type: 'Vehicle Crash',
    location: 'Main Street & Oak Ave',
    description: 'Multi-vehicle collision with reported injuries.',
    lat: 33.4484,
    lng: -112.0740,
    assignedUnit: 'P-12',
    active: true,
    createdAt: new Date().toISOString(),
    timerSeconds: 186,
  },
  {
    id: 'CALL-1002',
    priority: 'Urgent',
    department: 'EMS',
    type: 'Medical Emergency',
    location: 'Sunrise Clinic',
    description: 'Unresponsive patient with chest pain.',
    lat: 33.4749,
    lng: -112.0721,
    assignedUnit: 'E-07',
    active: true,
    createdAt: new Date().toISOString(),
    timerSeconds: 97,
  },
];

const units: UnitStatus[] = [
  { id: 'u-1', badge: 'P-12', department: 'Police', callSign: 'Delta 12', lat: 33.4486, lng: -112.0768, status: 'En Route', vehicle: 'PD Cruiser', eta: '4 min' },
  { id: 'u-2', badge: 'E-07', department: 'EMS', callSign: 'Medic 07', lat: 33.4744, lng: -112.0700, status: 'On Scene', vehicle: 'Ambulance', eta: 'Arrived' },
  { id: 'u-3', badge: 'F-03', department: 'Fire Rescue', callSign: 'Engine 03', lat: 33.4695, lng: -112.0820, status: 'Available', vehicle: 'Fire Engine', eta: 'Standby' },
  { id: 'u-4', badge: 'S-02', department: 'Sheriff', callSign: 'Sheriff 02', lat: 33.4412, lng: -112.0878, status: 'Available', vehicle: 'SUV', eta: 'Available' },
];

export const getActiveCalls = () => activeCalls;
export const getUnits = () => units;

export async function syncDatabase(): Promise<void> {
  try {
    await pool.query('SELECT NOW()');
    console.log('Database connection healthy.');
  } catch (err) {
    console.error('Database sync failed, continuing in demo mode:', err);
  }
}

export function pushDispatchEvent(event: DispatchEventPayload, broadcast: (payload: DispatchEventPayload) => void): void {
  const enriched = {
    ...event,
    timestamp: event.timestamp || new Date().toISOString(),
  };

  if (event.type === 'New911Call') {
    const generated = event.data as EmergencyCall;
    activeCalls.unshift(generated);
  }

  if (event.type === 'UnitStatusUpdate') {
    const data = event.data as Partial<UnitStatus>;
    const unit = units.find((item) => item.id === data.id);
    if (unit && data.status) unit.status = data.status;
    if (unit && data.lat) unit.lat = data.lat;
    if (unit && data.lng) unit.lng = data.lng;
  }

  if (event.type === 'PanicButton') {
    const payload = event.data as { unitId: string; location: string };
    const panicUnit = units.find((item) => item.id === payload.unitId);
    if (panicUnit) {
      panicUnit.status = 'Unavailable';
    }
  }

  broadcast(enriched);
}

export function generateAIIncident(broadcast: (payload: DispatchEventPayload) => void): void {
  const incidentCatalog = [
    {
      type: 'Structure Fire',
      department: 'Fire Rescue',
      location: 'Cedar Ridge Apartments',
      description: 'Smoke observed from upper floor, multiple occupants reported.',
      lat: 33.4650,
      lng: -112.0900,
      priority: 'Emergency',
    },
    {
      type: 'Domestic Dispute',
      department: 'Police',
      location: 'Willow Park Estates',
      description: 'Witnesses report an armed altercation and barricaded subject.',
      lat: 33.4532,
      lng: -112.0675,
      priority: 'Urgent',
    },
    {
      type: 'Medical Emergency',
      department: 'EMS',
      location: 'North Valley Clinic',
      description: 'Respiratory distress reported near the emergency room entrance.',
      lat: 33.4855,
      lng: -112.0708,
      priority: 'Urgent',
    },
  ];

  const incident = incidentCatalog[Math.floor(Math.random() * incidentCatalog.length)];
  const call: EmergencyCall = {
    id: `CALL-${Date.now()}`,
    priority: incident.priority as EmergencyCall['priority'],
    department: incident.department as Department,
    type: incident.type,
    location: incident.location,
    description: incident.description,
    lat: incident.lat,
    lng: incident.lng,
    active: true,
    createdAt: new Date().toISOString(),
    timerSeconds: Math.floor(Math.random() * 120) + 60,
  };

  activeCalls.unshift(call);
  broadcast({
    type: 'New911Call',
    timestamp: new Date().toISOString(),
    data: call,
  });
}
