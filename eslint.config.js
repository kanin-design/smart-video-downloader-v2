import raycastConfig from "@raycast/eslint-config";

// @raycast/eslint-config contains a nested array at index 5 that ESLint 9 rejects
export default raycastConfig.flat();
