-- A Public Rondo tier is a global logical pool, not one physical host.
UPDATE rondo_space_nodes
   SET node_id = NULL
 WHERE storage_kind = 1;

UPDATE rondo_spaces
   SET primary_node_id = NULL
 WHERE primary_node_space = 1;
