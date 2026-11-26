import assert from "node:assert/strict";
import {projectBody,checkProjection} from "../src/bodyProjection.ts";
checkProjection();
assert.throws(()=>projectBody(80,25,0,0,0));
assert.equal(projectBody(80,25,0,0,4).data.length,5);
console.log("Projection checks passed.");
