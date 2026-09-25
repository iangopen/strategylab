import { describeEvInvariant } from "../testUtils";
import { labouchere } from "./labouchere";

describeEvInvariant(labouchere, { sequence: "1-2-3-4", onComplete: "restart" });
