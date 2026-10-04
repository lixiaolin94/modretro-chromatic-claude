const id = "EVENT_CODEX_HARDWARE_PROFILE";

const fields = [
  {
    key: "variable",
    label: "Hardware profile variable",
    description: "Stores 1 on Game Boy Color hardware or 0 on monochrome hardware.",
    type: "variable",
    defaultValue: "LAST_VARIABLE",
  },
  {
    key: "color",
    label: "Game Boy Color",
    description: "Run only when color hardware is available.",
    type: "events",
  },
  {
    key: "monochrome",
    label: "Monochrome Game Boy",
    description: "Run on original Game Boy-compatible hardware.",
    type: "events",
  },
];

const makeAssignment = (eventId, variable, value) => ({
  id: eventId + ":codex-profile-" + value,
  command: "EVENT_SET_VALUE",
  args: {
    variable,
    value: {
      type: "number",
      value,
    },
  },
});

const compile = (input, helpers) => {
  const variable = input.variable || "LAST_VARIABLE";
  const eventId = helpers.event && helpers.event.id ? helpers.event.id : id;
  const colorEvents = Array.isArray(input.color) ? input.color : [];
  const monochromeEvents = Array.isArray(input.monochrome)
    ? input.monochrome
    : [];

  helpers.ifDeviceCGB(
    [makeAssignment(eventId, variable, 1)].concat(colorEvents),
    [makeAssignment(eventId, variable, 0)].concat(monochromeEvents),
  );
};

module.exports = {
  id,
  name: "Codex: Detect Hardware Profile",
  description:
    "Store the current Game Boy hardware profile and branch into color or monochrome-safe behavior.",
  groups: ["EVENT_GROUP_CONTROL_FLOW", "EVENT_GROUP_COLOR"],
  fields,
  compile,
};
