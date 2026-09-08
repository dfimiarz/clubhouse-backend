const { z } = require("zod");

const BUMPABILITY_POLICIES = Object.freeze({
    NEVER: "never",
    SECOND_REPEATER: "second_repeater",
    ANY_REPEATER: "any_repeater",
    ALWAYS: "always",
});

// Preserve the rule that existed before bumpability became configurable.
const DEFAULT_BUMPABILITY_POLICY = BUMPABILITY_POLICIES.SECOND_REPEATER;
const bumpabilityPolicySchema = z.enum(Object.values(BUMPABILITY_POLICIES));

module.exports = {
    BUMPABILITY_POLICIES,
    DEFAULT_BUMPABILITY_POLICY,
    bumpabilityPolicySchema,
};
