export type Department = 'Police' | 'Sheriff' | 'State Patrol' | 'Fire Rescue' | 'EMS' | 'Dispatch' | 'DOT' | 'SWAT';

export type DispatchEventType =
  | 'New911Call'
  | 'UnitStatusUpdate'
  | 'PanicButton'
  | 'BOLOIssued'
  | 'PursuitStarted'
  | 'FireAlarmTriggered'
  | 'SevereWeatherAlert'
  | 'UnitAssigned'
  | 'SceneCleared';

export interface EmergencyCall {
  id: string;
  priority: 'Routine' | 'Priority' | 'Urgent' | 'Emergency';
  department: Department;
  type: string;
  location: string;
  description: string;
  lat: number;
  lng: number;
  assignedUnit?: string;
  active: boolean;
  createdAt: string;
  timerSeconds: number;
}

export interface UnitStatus {
  id: string;
  badge: string;
  department: Department;
  callSign: string;
  lat: number;
  lng: number;
  status: 'Available' | 'En Route' | 'On Scene' | 'Unavailable';
  vehicle: string;
  eta: string;
}

export interface DispatchEventPayload {
  type: DispatchEventType;
  timestamp: string;
  /** Shape depends on `type`; consumers narrow it with a cast. */
  data: unknown;
}
