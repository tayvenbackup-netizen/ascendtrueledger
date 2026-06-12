export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      access_keys: {
        Row: {
          activated_at: string | null
          activation_city: string | null
          activation_country: string | null
          activation_ip: string | null
          activation_region: string | null
          created_at: string
          created_by: string | null
          device_count: number
          device_fingerprint: string | null
          expires_at: string | null
          group_id: string | null
          id: string
          is_bulk: boolean
          is_revoked: boolean
          is_sub_admin: boolean
          key_hash: string
          key_name: string | null
          key_preview: string
          key_type: Database["public"]["Enums"]["key_type"]
          key_value: string | null
          session_count: number
          total_play_seconds: number
        }
        Insert: {
          activated_at?: string | null
          activation_city?: string | null
          activation_country?: string | null
          activation_ip?: string | null
          activation_region?: string | null
          created_at?: string
          created_by?: string | null
          device_count?: number
          device_fingerprint?: string | null
          expires_at?: string | null
          group_id?: string | null
          id?: string
          is_bulk?: boolean
          is_revoked?: boolean
          is_sub_admin?: boolean
          key_hash: string
          key_name?: string | null
          key_preview: string
          key_type: Database["public"]["Enums"]["key_type"]
          key_value?: string | null
          session_count?: number
          total_play_seconds?: number
        }
        Update: {
          activated_at?: string | null
          activation_city?: string | null
          activation_country?: string | null
          activation_ip?: string | null
          activation_region?: string | null
          created_at?: string
          created_by?: string | null
          device_count?: number
          device_fingerprint?: string | null
          expires_at?: string | null
          group_id?: string | null
          id?: string
          is_bulk?: boolean
          is_revoked?: boolean
          is_sub_admin?: boolean
          key_hash?: string
          key_name?: string | null
          key_preview?: string
          key_type?: Database["public"]["Enums"]["key_type"]
          key_value?: string | null
          session_count?: number
          total_play_seconds?: number
        }
        Relationships: [
          {
            foreignKeyName: "access_keys_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "key_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      access_sessions: {
        Row: {
          created_at: string
          id: string
          key_id: string
          last_validated: string
          session_token: string
          session_token_hash: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          key_id: string
          last_validated?: string
          session_token: string
          session_token_hash?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          key_id?: string
          last_validated?: string
          session_token?: string
          session_token_hash?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "access_sessions_key_id_fkey"
            columns: ["key_id"]
            isOneToOne: false
            referencedRelation: "access_keys"
            referencedColumns: ["id"]
          },
        ]
      }
      app_settings: {
        Row: {
          id: string
          updated_at: string
          value: Json
        }
        Insert: {
          id: string
          updated_at?: string
          value?: Json
        }
        Update: {
          id?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      audit_logs: {
        Row: {
          action: string
          actor_id: string | null
          actor_label: string | null
          actor_type: string
          created_at: string
          id: string
          ip_address: string | null
          metadata: Json
          success: boolean
          target_id: string | null
          target_label: string | null
          target_type: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_label?: string | null
          actor_type: string
          created_at?: string
          id?: string
          ip_address?: string | null
          metadata?: Json
          success?: boolean
          target_id?: string | null
          target_label?: string | null
          target_type?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_label?: string | null
          actor_type?: string
          created_at?: string
          id?: string
          ip_address?: string | null
          metadata?: Json
          success?: boolean
          target_id?: string | null
          target_label?: string | null
          target_type?: string | null
        }
        Relationships: []
      }
      device_attempts: {
        Row: {
          blocked: boolean
          created_at: string
          device_fingerprint: string
          device_info: string | null
          id: string
          ip_address: string | null
          key_id: string
        }
        Insert: {
          blocked?: boolean
          created_at?: string
          device_fingerprint: string
          device_info?: string | null
          id?: string
          ip_address?: string | null
          key_id: string
        }
        Update: {
          blocked?: boolean
          created_at?: string
          device_fingerprint?: string
          device_info?: string | null
          id?: string
          ip_address?: string | null
          key_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "device_attempts_key_id_fkey"
            columns: ["key_id"]
            isOneToOne: false
            referencedRelation: "access_keys"
            referencedColumns: ["id"]
          },
        ]
      }
      game_rounds: {
        Row: {
          bet_amount: number
          created_at: string
          ended_at: string | null
          id: string
          key_id: string
          payout: number
          status: string
        }
        Insert: {
          bet_amount?: number
          created_at?: string
          ended_at?: string | null
          id?: string
          key_id: string
          payout?: number
          status?: string
        }
        Update: {
          bet_amount?: number
          created_at?: string
          ended_at?: string | null
          id?: string
          key_id?: string
          payout?: number
          status?: string
        }
        Relationships: []
      }
      key_groups: {
        Row: {
          color: string
          created_at: string
          created_by: string | null
          id: string
          name: string
        }
        Insert: {
          color?: string
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
        }
        Update: {
          color?: string
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
        }
        Relationships: []
      }
      key_sessions: {
        Row: {
          duration_seconds: number
          id: string
          key_id: string
          last_heartbeat: string
          session_token: string | null
          started_at: string
        }
        Insert: {
          duration_seconds?: number
          id?: string
          key_id: string
          last_heartbeat?: string
          session_token?: string | null
          started_at?: string
        }
        Update: {
          duration_seconds?: number
          id?: string
          key_id?: string
          last_heartbeat?: string
          session_token?: string | null
          started_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "key_sessions_key_id_fkey"
            columns: ["key_id"]
            isOneToOne: false
            referencedRelation: "access_keys"
            referencedColumns: ["id"]
          },
        ]
      }
      p2p_deposits: {
        Row: {
          amount: number
          claimed_at: string | null
          coin: string
          created_at: string
          from_address: string | null
          id: string
          memo: string | null
          to_address: string
        }
        Insert: {
          amount: number
          claimed_at?: string | null
          coin: string
          created_at?: string
          from_address?: string | null
          id?: string
          memo?: string | null
          to_address: string
        }
        Update: {
          amount?: number
          claimed_at?: string | null
          coin?: string
          created_at?: string
          from_address?: string | null
          id?: string
          memo?: string | null
          to_address?: string
        }
        Relationships: []
      }
      security_alerts: {
        Row: {
          attempt_city: string | null
          attempt_country: string | null
          attempt_ip: string | null
          attempt_region: string | null
          blocked: boolean
          created_at: string
          device_fingerprint: string | null
          device_info: string | null
          id: string
          key_id: string
          reason: string
          reviewed: boolean
        }
        Insert: {
          attempt_city?: string | null
          attempt_country?: string | null
          attempt_ip?: string | null
          attempt_region?: string | null
          blocked?: boolean
          created_at?: string
          device_fingerprint?: string | null
          device_info?: string | null
          id?: string
          key_id: string
          reason?: string
          reviewed?: boolean
        }
        Update: {
          attempt_city?: string | null
          attempt_country?: string | null
          attempt_ip?: string | null
          attempt_region?: string | null
          blocked?: boolean
          created_at?: string
          device_fingerprint?: string | null
          device_info?: string | null
          id?: string
          key_id?: string
          reason?: string
          reviewed?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "security_alerts_key_id_fkey"
            columns: ["key_id"]
            isOneToOne: false
            referencedRelation: "access_keys"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      key_type: "daily" | "3day" | "weekly" | "monthly" | "lifetime"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      key_type: ["daily", "3day", "weekly", "monthly", "lifetime"],
    },
  },
} as const
