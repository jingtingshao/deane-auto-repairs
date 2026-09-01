/** Public website booking — drop-off slots (Pacific/Auckland). */
const business = require("./business");
const { TIME_ZONE } = require("./nz-time");

const DROP_OFF_DURATION_MINUTES = 60;

const BOOKING_SERVICES = [
  { id: "WOF", label: "WOF inspection", durationMinutes: DROP_OFF_DURATION_MINUTES },
  { id: "Service", label: "Standard / Premium service", durationMinutes: DROP_OFF_DURATION_MINUTES },
  { id: "Repair", label: "Repairs / diagnostics", durationMinutes: DROP_OFF_DURATION_MINUTES },
  {
    id: "Pre-Purchase Inspection",
    label: "Pre-purchase inspection",
    durationMinutes: DROP_OFF_DURATION_MINUTES,
  },
];

module.exports = {
  timezone: TIME_ZONE,
  slotIntervalMinutes: 30,
  dropOffDurationMinutes: DROP_OFF_DURATION_MINUTES,
  /** First bookable drop-off time Mon–Sat. */
  firstSlotTime: "08:30",
  /** Last bookable drop-off time Mon–Sat. */
  lastSlotTime: "16:00",
  maxAdvanceWeeks: 8,
  /** Same drop-off time can accept multiple vehicles. */
  maxCarsPerSlot: 99,
  services: BOOKING_SERVICES,
  serviceById(id) {
    const key = String(id || "").trim();
    return BOOKING_SERVICES.find((s) => s.id === key) || null;
  },
  meta() {
    return {
      timezone: TIME_ZONE,
      slotIntervalMinutes: this.slotIntervalMinutes,
      dropOffDurationMinutes: this.dropOffDurationMinutes,
      firstSlotTime: this.firstSlotTime,
      lastSlotTime: this.lastSlotTime,
      maxAdvanceWeeks: this.maxAdvanceWeeks,
      maxCarsPerSlot: this.maxCarsPerSlot,
      services: BOOKING_SERVICES.map((s) => ({
        id: s.id,
        label: s.label,
        durationMinutes: s.durationMinutes,
      })),
      business: {
        name: business.name,
        addressLine2: business.addressLine2,
        street: business.street,
        suburb: business.suburb,
        city: business.city,
        phoneDisplay: business.phoneDisplay,
        phoneTel: business.phoneTel,
        email: business.email,
        hoursShort: business.hoursShort,
        hoursSunday: business.hoursSunday,
      },
    };
  },
};
