(function(root,factory){const api=factory();if(typeof module!=='undefined'&&module.exports)module.exports=api;root.HireRadarBatchPolicy=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  const capacity = (state = {}, maximum = 7) => {
    return maximum;
  };
  const outcome = (state = {}, stage) => stage === 'failed'
    ? { ...state, canaryFailed: false, failedCount: Number(state.failedCount || 0) + 1 }
    : { ...state, canaryCompleted: Number(state.canaryCompleted || 0) + 1 };
  const shouldRollover = (claimed = 0, active = 0, campaignSize = 50) =>
    Number(claimed || 0) >= campaignSize && Number(active || 0) === 0;
  return { capacity, outcome, shouldRollover };
});
