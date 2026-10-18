assert set(frame.season.unique()) == set(range(2020,2026)), 'Missing season'
train = frame[frame.season<=2023]
cal = frame[frame.season==2024]
test = frame[frame.season==2025]
assert min(len(train),len(cal),len(test))>100, 'Insufficient samples'
X = lambda f: np.asarray(f.features.tolist(),dtype=float)
assert np.isfinite(X(frame)).all(), 'Nonfinite features'

base = make_pipeline(StandardScaler(), LogisticRegression(max_iter=2000,C=1.0))
base.fit(X(train),train.y)
raw_cal = np.clip(base.predict_proba(X(cal))[:,1],1e-6,1-1e-6)
# Platt calibration fitted ONLY on 2024 (not on 2025).
logit = lambda p: np.log(p/(1-p)).reshape(-1,1)
calibrator = LogisticRegression(max_iter=2000,C=1000)
calibrator.fit(logit(raw_cal),cal.y)
raw_test = np.clip(base.predict_proba(X(test))[:,1],1e-6,1-1e-6)
prob = np.clip(calibrator.predict_proba(logit(raw_test))[:,1],1e-6,1-1e-6)
y = test.y.to_numpy()

bins=[]
for lo,hi in zip(np.arange(0,1,.1),np.arange(.1,1.01,.1)):
    mask=(prob>=lo)&(prob<(hi if hi<1 else 1.000001))
    bins.append({'range':f'{lo:.1f}-{hi:.1f}','games':int(mask.sum()),
                 'predicted':round(float(prob[mask].mean()),4) if mask.any() else None,
                 'observed':round(float(y[mask].mean()),4) if mask.any() else None})
report={'model':'pregame_logistic_v1','generated_utc':datetime.now(timezone.utc).isoformat(),
        'source':'nflverse historical schedules and play-by-play EPA',
        'train_seasons':'2020-2023','calibration_season':2024,'untouched_test_season':2025,
        'sample_counts':{'train':len(train),'calibration':len(cal),'test':len(test)},
        'test':{'brier':round(float(brier_score_loss(y,prob)),5),
                'log_loss':round(float(log_loss(y,prob)),5),
                'accuracy':round(float(accuracy_score(y,prob>=.5)),5),
                'roc_auc':round(float(roc_auc_score(y,prob)),5),
                'baseline_home_win_brier':round(float(brier_score_loss(y,np.full(len(y),train.y.mean()))),5)},
        'calibration_bins':bins,
        'limitations':['Only home-win probability; no spreads/totals yet',
                       'Season-reset eight-game rolling EPA and points',
                       'No injury, QB, or lineup information',
                       'Calibration sample is one season',
                       'One held-out season does not establish long-run profitability']}
joblib.dump({'base':base,'calibrator':calibrator,'features':['off_epa_diff','def_epa_allowed_diff','points_for_diff','points_allowed_diff','home_games','away_games'],
             'report':report},OUT/'nfl_win_model.joblib')
(OUT/'test_report.json').write_text(json.dumps(report,indent=2))
pred=test[['game_id','date','home','away','y']].copy()
pred['predicted_home_win_probability']=prob
pred.to_csv(OUT/'2025_heldout_predictions.csv',index=False)
print(json.dumps(report,indent=2))
