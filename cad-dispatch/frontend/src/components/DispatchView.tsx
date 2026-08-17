import { useEffect, useMemo, useState } from 'react';
import { CircleAlert, Flame, HeartPulse, ShieldAlert, Siren, Users, Waves } from 'lucide-react';
import { LiveMapView } from './LiveMapView';
import { apiRequest, API_URL, getToken } from '../api/client';

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

export function DispatchView() {
  const [calls, setCalls] = useState<CallRecord[]>([]);
  const [units, setUnits] = useState<UnitRecord[]>([]);
  const [alertCount, setAlertCount] = useState(0);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let closed = false;

    const loadInitialState = async () => {
      try {
        const [callsData, unitsData] = await Promise.all([
          apiRequest<{ calls: any[] }>('/api/dispatch/calls'),
          apiRequest<{ units: any[] }>('/api/units'),
        ]);

        if (closed) return;

        if (Array.isArray(callsData.calls)) {
          setCalls(callsData.calls.map((call: any) => ({
            id: call.id,
            type: call.type,
            priority: call.priority,
            department: call.department,
            location: call.location,
            description: call.description,
            assigned: call.assignedUnit || 'Pending',
            age: 'live',
          })));
        }

        if (Array.isArray(unitsData.units)) {
          setUnits(unitsData.units.map((unit: any) => ({
            id: unit.id,
            callSign: unit.callSign,
            department: unit.department,
            status: unit.status,
            vehicle: unit.vehicle,
            lat: unit.lat,
            lng: unit.lng,
          })));
        }
      } catch (error) {
        console.warn('Unable to load initial CAD state', error);
      }
    };

    loadInitialState();

    // The live feed authenticates with the session token on the handshake.
    const wsUrl = API_URL.replace(/^http/, 'ws');
    const ws = new WebSocket(`${wsUrl}?token=${encodeURIComponent(getToken() || '')}`);

    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);

    ws.onmessage = (event) => {
      const payload = JSON.parse(event.data);

      if (payload.type === 'New911Call') {
        const call = payload.data as any;
        setCalls((current) => [
          {
            id: call.id,
            type: call.type,
            priority: call.priority,
            department: call.department,
            location: call.location,
            description: call.description,
            assigned: call.assignedUnit || 'Pending',
            age: 'just now',
          },
          ...current,
        ]);
        setAlertCount((current) => current + 1);
      }

      if (payload.type === 'UnitStatusUpdate') {
        const updated = payload.data as Partial<UnitRecord> & { id: string };
        setUnits((current) => current.map((unit) => (
          unit.id === updated.id
            ? { ...unit, ...updated, status: String(updated.status || unit.status) }
            : unit
        )));
      }
    };

    return () => {
      closed = true;
      ws.close();
    };
  }, []);

  const summary = useMemo(() => ({
    dispatchers: 12,
    activeUnits: units.length,
    activeCalls: calls.length,
  }), [calls, units]);

  return (
    <>
      <div className="mb-4 flex items-center justify-end gap-3 text-sm">
        <div className={`rounded-full px-3 py-1 ${connected ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-500/20 text-slate-300'}`}>
          {connected ? 'Live sync active' : 'Reconnecting…'}
        </div>
        <div className="rounded-full bg-red-500/20 px-3 py-1 text-red-200">{alertCount} active alerts</div>
      </div>

      <section className="grid gap-4 xl:grid-cols-[1.25fr_0.75fr]">
        <div className="panel-glass rounded-3xl p-4">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-cyan-300">Live map</p>
              <p className="text-xs text-slate-400">Unit GPS, panic markers, routing, and dynamic weather</p>
            </div>
            <div className="rounded-full bg-cyan-500/15 px-3 py-1 text-xs text-cyan-200">Roblox sync</div>
          </div>
          <div className="h-[540px] overflow-hidden rounded-2xl border border-cyan-500/20">
            <LiveMapView units={units} calls={calls} />
          </div>
        </div>

        <div className="space-y-4">
          <div className="panel-glass rounded-3xl p-4">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-cyan-300">Dispatch board</p>
                <p className="text-xs text-slate-400">Priority handling with live call timers and tone-outs</p>
              </div>
              <Siren className="h-5 w-5 text-red-400" />
            </div>

            <div className="grid grid-cols-3 gap-2">
              {Object.entries(summary).map(([key, value]) => (
                <div key={key} className="rounded-2xl border border-slate-700/60 bg-slate-900/80 p-3">
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-400">{key}</p>
                  <p className="mt-2 text-2xl font-bold text-white">{value}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="panel-glass rounded-3xl p-4">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-cyan-300">Active calls</p>
                <p className="text-xs text-slate-400">Audio alarms, dispatch notes, and scene control</p>
              </div>
              <CircleAlert className="h-5 w-5 text-amber-300" />
            </div>

            <div className="space-y-2">
              {calls.map((call) => (
                <div key={call.id} className="rounded-2xl border border-slate-700/60 bg-slate-900/80 p-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-white">{call.type}</p>
                      <p className="text-xs text-slate-400">{call.location} · {call.department}</p>
                    </div>
                    <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${
                      call.priority === 'Emergency' ? 'bg-red-500/20 text-red-200' : 'bg-amber-500/20 text-amber-200'
                    }`}>
                      {call.priority}
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-slate-300">{call.description}</p>
                  <div className="mt-3 flex items-center justify-between text-[10px] uppercase tracking-[0.2em] text-slate-400">
                    <span>{call.assigned}</span>
                    <span>{call.age}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="panel-glass rounded-3xl p-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-cyan-300">Units &amp; MDT</p>
              <p className="text-xs text-slate-400">Status, GPS, and department assignments</p>
            </div>
            <Users className="h-5 w-5 text-cyan-300" />
          </div>

          <div className="space-y-2">
            {units.map((unit) => (
              <div key={unit.id} className="rounded-2xl border border-slate-700/60 bg-slate-900/80 p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-white">{unit.callSign} · {unit.id}</p>
                    <p className="text-xs text-slate-400">{unit.vehicle} · {unit.department}</p>
                  </div>
                  <span className="rounded-full bg-cyan-500/20 px-2 py-1 text-[10px] font-bold text-cyan-300">{unit.status}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="panel-glass rounded-3xl p-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-cyan-300">MDT / Records</p>
              <p className="text-xs text-slate-400">Warrants, BOLOs, jail intake, and hospital routing</p>
            </div>
            <HeartPulse className="h-5 w-5 text-emerald-300" />
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            {[
              { icon: ShieldAlert, label: 'Warrants', value: '14 active' },
              { icon: Flame, label: 'BOLOs', value: '6 issued' },
              { icon: Waves, label: 'Jail', value: '9 booked' },
              { icon: HeartPulse, label: 'Hospital Intake', value: '18 pending' },
            ].map((item) => (
              <div key={item.label} className="rounded-2xl border border-slate-700/60 bg-slate-900/80 p-3">
                <div className="flex items-center gap-2 text-cyan-300">
                  <item.icon className="h-4 w-4" />
                  <p className="text-sm font-medium">{item.label}</p>
                </div>
                <p className="mt-3 text-xl font-bold text-white">{item.value}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
