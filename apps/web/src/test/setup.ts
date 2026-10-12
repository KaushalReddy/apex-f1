// Tells React the test environment supports act(); silences noise from @react-three/test-renderer.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
