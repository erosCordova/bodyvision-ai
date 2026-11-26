ALTER TABLE public.sandbox_capture_objects ADD COLUMN IF NOT EXISTS posture text NOT NULL DEFAULT 'unspecified' CHECK (posture IN ('front','side','back','unspecified'));
