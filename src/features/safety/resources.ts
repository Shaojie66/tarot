import { z } from "zod";
import data from "../../../content/safety/resources.json";

const resourcesSchema = z.strictObject({
  region: z.string(),
  checkedAt: z.iso.date(),
  maintenance: z.string(),
  items: z.array(z.strictObject({ name: z.string(), contact: z.string(), note: z.string() })).min(1),
  directory: z.strictObject({ name: z.string(), url: z.url() }),
  advice: z.array(z.string()).min(1),
});

/** 求助资源。只收经过核实的号码，见 content/safety/resources.json 的 maintenance 说明。 */
export const HELP_RESOURCES = resourcesSchema.parse(data);
