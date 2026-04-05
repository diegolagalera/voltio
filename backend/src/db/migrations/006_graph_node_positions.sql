-- ============================================
-- 006: Graph Node Positions
-- Persists user-arranged node positions in the
-- factory graph view (VueFlow canvas)
-- ============================================

CREATE TABLE IF NOT EXISTS graph_node_positions (
    factory_id  UUID NOT NULL REFERENCES factories(id) ON DELETE CASCADE,
    node_id     VARCHAR(100) NOT NULL,
    pos_x       DOUBLE PRECISION NOT NULL DEFAULT 0,
    pos_y       DOUBLE PRECISION NOT NULL DEFAULT 0,
    updated_at  TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (factory_id, node_id)
);

CREATE INDEX IF NOT EXISTS idx_gnp_factory ON graph_node_positions(factory_id);
