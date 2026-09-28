(function(root,factory){const api=factory();if(typeof module!=='undefined'&&module.exports)module.exports=api;root.HireRadarBatchPolicy=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  const capacity = (state = {}, maximum = 7) => {
    return maximum;
  };
  const outcome = (state = {}, stage) => stage === 'failed'
    ? { ...state, canaryFailed: false, failedCount: Number(state.failedCount || 0) + 1 }
    : { ...state, canaryCompleted: Number(state.canaryCompleted || 0) + 1 };
  return { capacity, outcome };
});
