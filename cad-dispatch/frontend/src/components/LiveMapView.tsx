import { MapContainer, Marker, Polyline, Popup, TileLayer } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

interface CallRecord {
  id: string;
  type: string;
  priority: string;
  department: string;
  location: string;
  description: string;
  assigned: string;
  age: string;
}

interface UnitRecord {
  id: string;
  callSign: string;
  department: string;
  status: string;
  vehicle: string;
  lat: number;
  lng: number;
}

const pastel = [
  { color: '#22c55e', icon: '🚓' },
  { color: '#06b6d4', icon: '🚑' },
  { color: '#fb7185', icon: '🚒' },
  { color: '#fbbf24', icon: '🛡️' },
];

const createIcon = (color: string, label: string) =>
  L.divIcon({
    className: 'custom-leaflet-marker',
    html: `<div style="background:${color};width:24px;height:24px;border-radius:999px;border:2px solid white;display:flex;align-items:center;justify-content:center;font-size:10px">${label}</div>`,
    iconSize: [24, 24],
  });

export function LiveMapView({ units, calls }: { units: UnitRecord[]; calls: CallRecord[] }) {
  const route = units.map((unit) => [unit.lat, unit.lng] as [number, number]);

  return (
    <MapContainer center={[33.4484, -112.0740]} zoom={12} scrollWheelZoom style={{ height: '100%', width: '100%' }}>
      <TileLayer
        attribution="&copy; OpenStreetMap contributors"
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <TileLayer
        attribution="MapTiler"
        url="https://api.maptiler.com/maps/streets/{z}/{x}/{y}.png?key=demo"
      />

      <Polyline positions={route} color="#06b6d4" dashArray="8 6" weight={3} />

      {units.map((unit, index) => (
        <Marker key={unit.id} position={[unit.lat, unit.lng]} icon={createIcon(pastel[index % pastel.length].color, pastel[index % pastel.length].icon)}>
          <Popup>
            <div className="text-sm">
              <strong>{unit.callSign}</strong><br />
              {unit.department}<br />
              {unit.status}<br />
              {unit.vehicle}
            </div>
          </Popup>
        </Marker>
      ))}

      {calls.map((call, index) => (
        <Marker key={call.id} position={[33.4484 + (index * 0.003), -112.0740 + (index * -0.004)]} icon={createIcon('#fb7185', '⚠️')}>
          <Popup>
            <div className="text-sm">
              <strong>{call.type}</strong><br />
              {call.location}<br />
              {call.description}
            </div>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
