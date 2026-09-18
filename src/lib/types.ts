import type { Attendance, Role } from "./domain";
export interface Player {
  id: string;
  first_name: string;
  last_name: string;
  birth_year?: number | null;
  team: string;
}
export interface Period {
  id: string;
  player_id: string;
  product_name: string;
  starts_at: string;
  ends_at: string;
  included_units: number;
  athletics_units?: number;
  tariff_generation?: string;
  status: string;
  subscription_id: string;
  subscription_status?: string;
  stripe_customer_id?: string;
}
export interface Training {
  id: string;
  revision?: number;
  internal_note?: string;
  title: string;
  starts_at: string;
  ends_at: string;
  location_id: string;
  location_name: string;
  address: string;
  trainer_id: string;
  trainer_name: string;
  event_type: string;
  status: string;
  auto_attendance_at: string;
  participants: {
    id: string;
    player_id: string;
    period_id: string | null;
    status: Attendance;
    reason?: string | null;
    removed_from_event?: boolean;
  }[];
}
export interface Report {
  id: string;
  player_id: string;
  period_id: string;
  version: number;
  created_at: string;
  product_name: string;
  period_label: string;
  completed: number;
  units: number;
  minutes: number;
  football_completed?: number;
  athletics_completed?: number;
  athletics_units?: number;
}
export interface PortalData {
  camp_enabled?: boolean;
  camp_access?: "active" | "past" | "only";
  role: Role;
  user_name: string;
  email: string;
  players: Player[];
  periods: Period[];
  events: Training[];
  reports: Report[];
  locations: { id: string; name: string; address: string }[];
  trainers: { id: string; name: string }[];
  whatsapp: string;
  billing_customers?: { stripe_customer_id: string }[];
}
