-- Refresh PostgREST's schema cache after the staff password reset RPCs are added.
notify pgrst, 'reload schema';
