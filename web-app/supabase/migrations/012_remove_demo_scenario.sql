-- Migration: Remove demo_scenario from anonymous_sessions
-- Description: Demo scenario is fixed, not user-selected. Scenario selection is for real lessons only.

ALTER TABLE anonymous_sessions DROP COLUMN IF EXISTS demo_scenario;

-- Log
DO $$
BEGIN
  RAISE NOTICE 'Removed demo_scenario column - demo has fixed scenario, selection is for real lessons';
END $$;

COMMENT ON TABLE anonymous_sessions IS 'Anonymous user sessions: UTM, funnel (JSONB), demo (JSONB). Demo scenario is fixed.';

