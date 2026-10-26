use serde::Deserialize;
use std::collections::HashMap;
use std::sync::OnceLock;

#[derive(Deserialize)]
struct Lexicon {
    provinces: HashMap<String, Vec<String>>,
    positive: Vec<String>,
    negative: Vec<String>,
    disaster: Vec<String>,
}

fn lexicon() -> &'static Lexicon {
    static LEX: OnceLock<Lexicon> = OnceLock::new();
    LEX.get_or_init(|| serde_json::from_str(include_str!("lexicon.json")).expect("lexicon.json invalid"))
}

/// 返回 (省份, 情绪 positive/negative/neutral, 是否灾害)
pub fn classify(text: &str) -> (Option<String>, Option<String>, String, bool) {
    let lex = lexicon();
    let mut matches = Vec::new();
    for (province, kws) in &lex.provinces {
        for kw in kws {
            if text.contains(kw) {
                matches.push((province.as_str(), kw.as_str()));
            }
        }
    }
    let mut matched_provinces: Vec<&str> = matches.iter().map(|(p, _)| *p).collect();
    matched_provinces.sort_unstable();
    matched_provinces.dedup();
    let (province, location_match) = if matched_provinces.len() == 1 {
        let province = matched_provinces[0];
        let keyword = matches
            .iter()
            .filter(|(p, _)| *p == province)
            .map(|(_, keyword)| *keyword)
            .max_by(|a, b| a.chars().count().cmp(&b.chars().count()).then_with(|| a.cmp(b)));
        (Some(province.to_string()), keyword.map(str::to_string))
    } else {
        (None, None)
    };
    let disaster = lex.disaster.iter().any(|w| text.contains(w));
    let pos = lex.positive.iter().filter(|w| text.contains(*w)).count();
    let neg = lex.negative.iter().filter(|w| text.contains(*w)).count();
    let sentiment = if disaster || neg > pos {
        "negative".to_string()
    } else if pos > neg {
        "positive".to_string()
    } else {
        "neutral".to_string()
    };
    (province, location_match, sentiment, disaster)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classification_works() {
        assert_eq!(
            classify("四川雅安地震已致3人受伤"),
            (Some("四川省".into()), Some("雅安".into()), "negative".into(), true)
        );
        assert_eq!(
            classify("上海地铁新线今日开通运营"),
            (Some("上海市".into()), Some("上海".into()), "neutral".into(), false)
        );
        assert_eq!(classify("我国GDP同比增长5%创历史新高"), (None, None, "positive".into(), false));
        assert_eq!(
            classify("深圳市昨日查处一家违规排污企业"),
            (Some("广东省".into()), Some("深圳".into()), "negative".into(), false)
        );
        assert_eq!(
            classify("台风“杜苏芮”在福建登陆"),
            (Some("福建省".into()), Some("福建".into()), "negative".into(), true)
        );
        assert_eq!(classify("全国高考今日开始"), (None, None, "neutral".into(), false));
    }

    #[test]
    fn ambiguous_titles_are_not_assigned_to_a_province() {
        let (province, evidence, _, _) = classify("北京至深圳高铁计划引发关注");
        assert_eq!(province, None);
        assert_eq!(evidence, None);
    }

    #[test]
    fn company_and_market_aliases_do_not_claim_a_location() {
        assert_eq!(classify("台积电公布新一代芯片计划").0, None);
        assert_eq!(classify("港股今日震荡收盘").0, None);
    }
}
