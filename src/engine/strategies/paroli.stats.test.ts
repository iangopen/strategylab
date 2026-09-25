import { describeEvInvariant } from "../testUtils";
import { paroli } from "./paroli";

describeEvInvariant(paroli, { streakCap: 3 });
