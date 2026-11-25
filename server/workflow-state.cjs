const activeStatuses=new Set(['queued','running','stopping']);
const workflowActive=(data,id)=>(data.workflowJobs||[]).find(job=>job.draftId===id&&activeStatuses.has(job.status));
function workflowInput(draft){const value=structuredClone(draft);for(const key of ['step','title','mode','createdAt','updatedAt','artifacts'])delete value[key];if(value.video)delete value.video.routing;return JSON.stringify(value);}
module.exports={activeStatuses,workflowActive,workflowInput};
